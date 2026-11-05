"""Which domains link to a competitor, from Common Crawl's free web graph. Domains only: no page or anchor text.

The files are too big to keep or to process on hosting, so this runs on the Mac about every few months. Reading goes
as a stream, so only the 1 GB list of domains touches the disk. About 11 GB passes through, which took about 7 minutes.

Formats, from the files: vertices `id<TAB>reversed.domain<TAB>hosts`, edges `from_id<TAB>to_id` sorted by from_id,
ranks `harmonic_position<TAB>...<TAB>reversed.domain<TAB>hosts` sorted best first.
"""
from __future__ import annotations

import time
import zlib
from bisect import bisect_left, bisect_right
from typing import Callable, Iterable, Iterator

import httpx

GRAPH_LIST = "https://index.commoncrawl.org/graphinfo.json"
FILE = "https://data.commoncrawl.org/projects/hyperlinkgraph/{release}/domain/{release}-domain-{kind}.txt.gz"
USER_AGENT = "PageChangeBot/0.1"
CHUNK_BYTES = 1024 * 1024
TRIES = 10


def reverse_domain(domain: str) -> str:
    return ".".join(reversed(domain.split(".")))


def latest_release(client: httpx.Client) -> dict:
    newest = client.get(GRAPH_LIST).raise_for_status().json()[0]
    return {"id": newest["id"], "domains": newest["stats"]["domain"]["nodes"], "links": newest["stats"]["domain"]["arcs"]}


def file_url(release: str, kind: str) -> str:
    return FILE.format(release=release, kind=kind)


def download_chunks(client: httpx.Client, url: str, sleep: Callable[[float], None] = time.sleep) -> Iterator[bytes]:
    """One connection, picking up where it left off. It slows down when asked, and gives up rather than pushing on."""
    position = 0
    failures = 0
    while True:
        headers = {"Range": f"bytes={position}-"} if position else {}
        try:
            with client.stream("GET", url, headers=headers) as reply:
                if reply.status_code == 416:
                    return  # asked for past the end: it's all here
                if reply.status_code in (429, 500, 502, 503, 504):
                    raise httpx.TransportError(f"The server answered {reply.status_code}")
                reply.raise_for_status()
                for chunk in reply.iter_raw(CHUNK_BYTES):
                    position += len(chunk)
                    failures = 0
                    yield chunk
            return
        except httpx.TransportError:
            failures += 1
            if failures >= TRIES:
                raise
            sleep(min(600, 15 * 2 ** (failures - 1)))


def gunzip_blocks(chunks: Iterable[bytes]) -> Iterator[bytes]:
    """These files can be several gzip parts one after another."""
    state = zlib.decompressobj(31)
    for chunk in chunks:
        while chunk:
            out = state.decompress(chunk)
            if out:
                yield out
            if state.eof:
                chunk = state.unused_data
                state = zlib.decompressobj(31)
            else:
                chunk = b""
    tail = state.flush()
    if tail:
        yield tail


def whole_lines(blocks: Iterable[bytes]) -> Iterator[bytes]:
    """Blocks that always end at the end of a line, and always end with a newline."""
    rest = b""
    for block in blocks:
        block = rest + block
        cut = block.rfind(b"\n")
        if cut < 0:
            rest = block
            continue
        rest = block[cut + 1:]
        yield block[:cut + 1]
    if rest:
        yield rest + b"\n"


def find_ids(blocks: Iterable[bytes], domains: list[str]) -> dict[str, int]:
    """Domain -> its number in the graph. A domain the crawl never saw is left out."""
    wanted = {f"\t{reverse_domain(d)}\t".encode(): d for d in domains}
    found: dict[str, int] = {}
    for block in blocks:
        for needle, domain in wanted.items():
            if domain in found:
                continue
            at = block.find(needle)
            if at >= 0:
                found[domain] = int(block[block.rfind(b"\n", 0, at) + 1:at])
        if len(found) == len(wanted):
            break
    return found


def find_referrers(blocks: Iterable[bytes], targets: dict[int, str], progress: Callable[[int], None] = lambda n: None) -> dict[str, dict[int, int]]:
    """Competitor -> {linking domain's number: how many domains it links to}. Each domain's links sit together, as the file is sorted."""
    out: dict[str, dict[int, int]] = {domain: {} for domain in targets.values()}
    needles = [(f"\t{number}\n".encode(), domain) for number, domain in targets.items()]
    read = 0
    for block in blocks:
        read += len(block)
        progress(read)
        counts: dict[bytes, int] = {}
        for needle, domain in needles:
            at = block.find(needle)
            while at >= 0:
                start = block.rfind(b"\n", 0, at) + 1
                source = block[start:at]
                if source not in counts:
                    # A domain whose links cross into the next block is undercounted, but one that big passes the limit in one block.
                    counts[source] = block.count(b"\n" + source + b"\t") + int(block.startswith(source + b"\t"))
                number = int(source)
                out[domain][number] = max(out[domain].get(number, 0), counts[source])
                at = block.find(needle, at + 1)
    return out


def names_for(blocks: Iterable[bytes], numbers: set[int]) -> dict[int, tuple[str, int]]:
    """Number -> (domain, hosts). Numbers run in file order, so most lines needn't be looked at."""
    wanted = sorted(numbers)
    found: dict[int, tuple[str, int]] = {}
    for block in blocks:
        first_tab = block.find(b"\t")
        if first_tab < 0:
            continue
        first = int(block[:first_tab])
        lines = block[:-1].split(b"\n")
        last = int(lines[-1].split(b"\t", 1)[0])
        for number in wanted[bisect_left(wanted, first):bisect_right(wanted, last)]:
            line = lines[number - first] if last - first + 1 == len(lines) else next((x for x in lines if x.startswith(b"%d\t" % number)), None)
            if line is None:
                continue
            parts = line.decode("utf-8", "replace").split("\t")
            found[number] = (reverse_domain(parts[1]), int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0)
        if len(found) == len(wanted):
            break
    return found


def ranks_for(blocks: Iterable[bytes], domains: set[str], stop_after: int) -> dict[str, int]:
    """Domain -> its place. The file is sorted best first, so reading can stop early at `stop_after`."""
    wanted = {reverse_domain(d) for d in domains}
    found: dict[str, int] = {}
    for block in blocks:
        for line in block.split(b"\n"):
            if not line or line.startswith(b"#"):
                continue
            parts = line.split(b"\t")
            if len(parts) < 5:
                continue
            place = int(parts[0])
            if place > stop_after:
                return found
            name = parts[4].decode("utf-8", "replace")
            if name in wanted:
                found[reverse_domain(name)] = place
        if len(found) == len(wanted):
            break
    return found
