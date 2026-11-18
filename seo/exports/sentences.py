"""French for the sentences the server writes in English, by their pattern.

Alerts and Today's to-do lines are stored and sent as finished English sentences (seo/metrics/today.py,
seo/health/service.py, seo/uptime/service.py, seo/backlinks/live.py, seo/collectors/jobs.py, seo/insights/engine.py).
The screens translate them in the browser by pattern (today-live.js). An export is made on the server, so the same
patterns live here. A sentence that matches none stays as it is; tests/test_exports.py lists the ones that must.
"""
from __future__ import annotations

import re
from typing import Callable

_WHAT = {"security certificate": "certificat de sécurité", "domain name": "nom de domaine"}
_MATCH = {"contains": "contient", "doesn't contain": "ne contient pas", "is exactly": "est exactement", "matches": "correspond à"}
# seo/health/audit.py SITE_CHECKS in lower case, as seo/health/service.py joins them in an alert's title. The first six are
# the wording since 2026-11-11; the others stay for alerts saved before.
_SITE_CHECKS = {
    "start page didn't load": "la page de départ n'a pas chargé",
    "start page hidden from search engines": "la page de départ est cachée aux moteurs de recherche",
    "robots.txt gives a server error, so search engines stay away": "le robots.txt renvoie une erreur du serveur, donc les moteurs de recherche restent à l'écart",
    "certificate expired": "certificat expiré",
    "certificate expires within 14 days": "le certificat expire sous 14 jours",
    "certificate couldn't be verified": "certificat non vérifiable",
    "the start page didn't load": "la page de départ n'a pas chargé",
    "the start page is hidden from search engines": "la page de départ est cachée aux moteurs de recherche",
    "the site's robots.txt answers with a server error, so search engines stay away": "le robots.txt du site répond par une erreur du serveur, donc les moteurs de recherche restent à l'écart",
    "the security certificate has expired": "le certificat de sécurité a expiré",
    "the security certificate expires within 14 days": "le certificat de sécurité expire dans moins de 14 jours",
    "the security certificate couldn't be verified": "le certificat de sécurité n'a pas pu être vérifié",
}


def _day(words: str) -> str:
    """A day the server wrote as 2026-11-22, as a French reader writes it: 22 nov. 2026."""
    from seo.exports import fmt

    found = fmt.as_day(words) if re.fullmatch(r"\d{4}-\d\d-\d\d", words) else None
    return fmt.day("fr", found) if found else words


def _whole_site(m: re.Match) -> str | None:
    parts = m.group(2).split("; ")
    if not all(part in _SITE_CHECKS for part in parts):
        return None
    return f"{m.group(1)} : " + " ; ".join(_SITE_CHECKS[part] for part in parts)


# (pattern, French). {1}, {2}… are the pattern's groups. A function gets the match and may say None for "not this one".
_PATTERNS: list[tuple[str, str | Callable[[re.Match], str | None]]] = [
    # Today's to-do: alerts
    (r"^Clarity data lost in (\d+) h$", "Données Clarity perdues dans {1} h"),
    (r"^Clarity data is being lost$", "Des données Clarity sont en train d'être perdues"),
    (r"^(?:Clarity keeps only 3 days of data|Clarity only keeps the last 3 days for the app to read)\.$", "Clarity ne garde que 3 jours de données."),
    (r"^(.+): the (security certificate|domain name) expires on (.+)$", lambda m: f"{m.group(1)} : le {_WHAT[m.group(2)]} expire le {_day(m.group(3))}"),
    (r"^(.+): the (security certificate|domain name) has expired$", lambda m: f"{m.group(1)} : le {_WHAT[m.group(2)]} a expiré"),
    (r"^(.+): health fell from (\d+) to (\d+)$", "{1} : la santé est passée de {2} à {3}"),
    (r"^(.+): health is low at (\d+)$", "{1} : la santé est basse, à {2}"),
    (r"^(.+): the health test couldn't finish$", "{1} : le test de santé n'a pas pu se terminer"),
    (r"^(.+): the health test couldn't read any page$", "{1} : le test de santé n'a pu lire aucune page"),
    (r"^The worker stopped before this (test|scan) finished\.(?: Run it again\.)?$", "Le traitement s'est arrêté avant la fin. Relancez-le."),
    (r"^(.+) is down$", "{1} est hors ligne"),
    (r"^(.+) was down for (\d+) min and is back up$", "{1} a été hors ligne pendant {2} min et est de nouveau en ligne"),
    (r"^(.+): a backlink was lost$", "{1} : un backlink a été perdu"),
    (r"^(.+): (\d+) backlinks were lost$", "{1} : {2} backlinks ont été perdus"),
    (r"^(.+): a backlink changed$", "{1} : un backlink a changé"),
    (r"^(.+): (\d+) backlinks changed$", "{1} : {2} backlinks ont changé"),
    (r"^(.+) stopped working on (\d+) sites$", "{1} ne fonctionne plus sur {2} sites"),
    (r"^(.+) stopped working$", "{1} ne fonctionne plus"),
    (r"^A background job stopped: (.+)$", "Une tâche de fond s'est arrêtée : {1}"),
    # Today's to-do: what the Search insights found. Alerts saved before 2026-11-11 say a drop the old way: both are read.
    (r"^(.+?)(?: lost (\d+)% of its Google clicks|: −(\d+)% Google clicks)$", lambda m: f"{m.group(1)} : −{m.group(2) or m.group(3)} % de clics Google"),
    (r"^(.+) dropped out of Google$", "{1} a disparu de Google"),
    (r"^(.+) is slowly losing clicks$", "{1} perd lentement des clics"),
    (r"^“(.*)” is almost on page 1$", "« {1} » est presque en page 1"),
    (r"^“(.*)” is close to the top 3$", "« {1} » est proche du top 3"),
    (r"^“(.*)” is clicked less than usual$", "« {1} » est moins cliquée que d'habitude"),
    (r"^“(.*)” is seen but never clicked$", "« {1} » est vue mais jamais cliquée"),
    (r"^Two of your pages compete for “(.*)”$", "Deux de vos pages se concurrencent sur « {1} »"),
    (r"^Google clicks fell on (.+)$", "Les clics Google ont chuté le {1}"),
    (r"^“(.*)” lost places on Google$", "« {1} » a perdu des places sur Google"),
    (r"^(.+) carries most of the drop in clicks$", "{1} porte l'essentiel de la baisse des clics"),
    (r"^Google keeps moving “(.*)” up and down$", "Google fait sans cesse monter et descendre « {1} »"),
    (r"^Non-brand clicks fell (\d+)%, hidden by brand searches$", "Les clics hors marque ont baissé de {1} %, masqués par les recherches de marque"),
    (r"^“(.*)” is slowly losing places$", "« {1} » perd lentement des places"),
    (r"^(.+) is close to page 1 on many searches$", "{1} est proche de la page 1 sur de nombreuses recherches"),
    (r"^“(.*)” has no page of its own$", "« {1} » n'a pas de page à elle"),
    (r"^Searches with “(.*)” have no strong page$", "Les recherches avec « {1} » n'ont pas de page forte"),
    (r"^(.+) brings leads and is losing clicks$", "{1} apporte des demandes et perd des clics"),
    (r"^Google shows (.+), but it's broken$", "Google affiche {1}, mais elle est cassée"),
    # their details
    (r"^(?:Week on week|Last 7 days against the 7 before): (.+)$", "Semaine sur semaine : {1}"),
    (r"^(?:~(\d+) clicks/month|About (\d+) clicks a month) at stake(?:\. See Search → Insights\.)?$", lambda m: f"~{m.group(1) or m.group(2)} clics/mois en jeu"),
    # the Links checker's reasons with a number or an address in them (seo/links/checker.py)
    (r"^(\d+) redirects before the final page$", "{1} redirections avant la page finale"),
    (r"^More than (\d+) redirects, so the check gave up$", "Plus de {1} redirections : la vérification a abandonné"),
    (r"^Redirects to another website: (.+)$", "Redirige vers un autre site : {1}"),
    (r"^Took (\d+)\.(\d) s to answer$", "A mis {1},{2} s à répondre"),
    (r"^The site answered (\d+)$", "Le site a répondu {1}"),
    (r"^The request failed: (.+)$", "La requête a échoué : {1}"),  # {1} is the network library's own words, in English
    # Today's export: Google Analytics' own days, under Search Console's period (seo/exports/views_traffic.py today)
    (r"^Visits and leads: (\d{4}-\d\d-\d\d) – (\d{4}-\d\d-\d\d), where Google Analytics' data ends\.$", lambda m: f"Visites et demandes : {_day(m.group(1))} – {_day(m.group(2))}, là où s'arrêtent les données de Google Analytics."),
    # Overview's export: a long period drawn in whole weeks
    (r"^The first (\d+) days are counted in the totals, not drawn: a short week would look like a fall\.$", "Les {1} premiers jours sont comptés dans les totaux, pas dessinés : une semaine incomplète ressemblerait à une chute."),
    (r"^The last (\d+) days aren't final yet in Google: they are left out of the charts and totals\.$", "Les {1} derniers jours ne sont pas encore définitifs chez Google : ils sont exclus des graphiques et des totaux."),
    # filters in the file's header: how a typed text is matched
    (r"^(contains|doesn't contain|is exactly|matches) “(.*)”$", lambda m: f"{_MATCH[m.group(1)]} « {m.group(2)} »"),
    # whole-site health problems, several in one title; and the same alert on several sites
    (r"^([^:]+): (.+)$", _whole_site),
    (r"^(.+) on (\d+) sites$", lambda m: (lambda inner: f"{inner} sur {m.group(2)} sites" if inner else None)(french(m.group(1)))),
]
_COMPILED = [(re.compile(pattern), answer) for pattern, answer in _PATTERNS]


def french(sentence: str) -> str | None:
    """The sentence in French, or None when it matches no pattern."""
    for pattern, answer in _COMPILED:
        m = pattern.match(sentence)
        if not m:
            continue
        if callable(answer):
            found = answer(m)
        else:
            found = answer
            for index, group in enumerate(m.groups(), start=1):
                found = found.replace(f"{{{index}}}", group or "")
        if found:
            return found
    return None
