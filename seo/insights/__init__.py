"""Search insights: analyses written in plain code that run after each new final day of Search Console data.

Each detector reads the saved days and returns findings. The engine keeps them between runs (search_findings), ranks them by
clicks at stake a month, raises an app alert for the big drops only, and feeds Today. AI never creates or ranks a finding.
"""
