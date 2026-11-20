"""Every API route, with the sections it belongs to and what kind of action it is. Read by `seo.accounts.access.check`.

A route missing here is refused to anyone with chosen access, and tests/test_user_access.py fails, so a new route has
to be placed before it can leak. Admins and full-access members never reach this table.

Each entry is (sections, kind, flags):
- sections: the menu sections it serves, space separated. Several when screens share it (Keywords and Competitors both
  read rankings). "*" means any signed-in person: sign-in itself, logos, the site list.
- kind:
    read   looks only (some are POSTs: a preview, an estimate, an export)
    self   marks what this person has seen or read; View only allows it
    write  changes something in that section; needs Can edit
    spend  may spend paid credits; needs Can edit and Can spend credits
    global changes something every site shares; needs Can edit and every site
    gspend global and paid at once
    admin  Settings, keys, connections, the team: admins only
    paid?  write, or spend when the JSON body asks for paid searches (allow_paid true)
- flags:
    all    with no site_id it answers for "all sites", and that answer has been checked to cover only this person's
           sites (through access.own_site_ids / site_clause). Without this flag, a person who lacks some sites must
           name one of theirs.
    free   no site is involved at all (a list the whole account shares, like mediators), so no site is checked.
"""
from __future__ import annotations

# Path, query and JSON keys that point at something stored, and how to find its site. A query returning no row lets
# the route answer 404 itself; a row with site_id NULL is "for every site"; several rows (a competitor or keyword
# several sites follow) pass when any of them is theirs.
OWNERS = {
    "task_id": "SELECT site_id FROM tasks WHERE id = :v",
    "note_id": "SELECT site_id FROM notes WHERE id = :v",
    "file_id": "SELECT n.site_id FROM note_files f JOIN notes n ON n.id = f.note_id WHERE f.id = :v",
    "backlink_id": "SELECT site_id FROM backlinks WHERE id = :v",
    "prospect_id": "SELECT site_id FROM prospects WHERE id = :v",
    "resource_id": "SELECT site_id FROM resources WHERE id = :v",
    "pair_id": "SELECT site_id FROM page_pairs WHERE id = :v",
    "audit_id": "SELECT site_id FROM health_audits WHERE id = :v",
    "scan_id": "SELECT site_id FROM link_scans WHERE id = :v",
    "finding_id": "SELECT site_id FROM search_findings WHERE id = :v",
    "alert_id": "SELECT site_id FROM alerts WHERE id = :v",
    "notification_id": "SELECT site_id FROM notifications WHERE id = :v",
    "social_item_id": "SELECT site_id FROM social_items WHERE id = :v",
    "transcript_batch_id": "SELECT site_id FROM social_transcript_batches WHERE id = :v",
    "transcript_id": "SELECT site_id FROM social_transcripts WHERE id = :v",
    "rule_id": "SELECT site_id FROM site_rules WHERE id = :v",
    "page_id": "SELECT site_id FROM gsc_linked_pages WHERE id = :v",
    "competitor_id": "SELECT site_id FROM site_competitors WHERE competitor_id = :v",
    "keyword_id": "SELECT site_id FROM site_keywords WHERE keyword_id = :v",
}
# The same path key means another table on these routes.
OWNER_OVERRIDES = {
    "competitors_api.keyword_run": {"run_id": "SELECT site_id FROM keyword_uploads WHERE id = :v"},

    "search_api.delete_note": {"note_id": "SELECT site_id FROM search_notes WHERE id = :v"},
    # The site sent with these decides: after "stop following" their own row is gone, so the keyword's other sites would refuse the undo.
    # The route itself only touches that site's row (rankings.forget / follow_again, probe.*), and the guard checks the site.
    "keywords_api.forget": {"keyword_id": None}, "keywords_api.restore": {"keyword_id": None}, "keywords_api.detail": {"keyword_id": None},
    "competitors_api.keyword_check_remove": {"keyword_id": None}, "competitors_api.keyword_check_restore": {"keyword_id": None},
    "competitors_api.keyword_check_track": {"keyword_id": None},
    # A Refresh started at All sites has no site of its own: it belongs to the sites whose keywords it checks.
    "keywords_api.run": {"run_id": "SELECT site_id FROM rank_runs WHERE id = :v AND site_id IS NOT NULL UNION "
                                  "SELECT sk.site_id FROM rank_run_items i JOIN site_keywords sk ON sk.keyword_id = i.keyword_id WHERE i.run_id = :v"},
    "keywords_api.cancel": {"run_id": "SELECT site_id FROM rank_runs WHERE id = :v AND site_id IS NOT NULL UNION "
                                     "SELECT sk.site_id FROM rank_run_items i JOIN site_keywords sk ON sk.keyword_id = i.keyword_id WHERE i.run_id = :v"},
}
# Lists of stored things in a JSON body: each one is checked.
LIST_OWNERS = {
    "competitors_api.remove_prospects": ("ids", "SELECT site_id FROM prospects WHERE id = :v"),
    "backlinks_api.todo_move": ("prospect_ids", "SELECT site_id FROM prospects WHERE id = :v"),
    "backlinks_api.todo_move_back": ("ids", "SELECT site_id FROM backlinks WHERE id = :v"),
    "backlinks_api.todo_sent": ("ids", "SELECT site_id FROM backlinks WHERE id = :v"),
    "keywords_api.preview": ("keyword_ids", "SELECT site_id FROM site_keywords WHERE keyword_id = :v"),
    "keywords_api.start": ("keyword_ids", "SELECT site_id FROM site_keywords WHERE keyword_id = :v"),
}
# A list of rows that each name their site.
ROW_SITES = {"competitors_api.save_backlinks": "rows"}

# Which section an export belongs to, by its view id (seo/exports/views_*.py). They all share one address.
EXPORT_SECTIONS = {
    "channels": "channels", "conversions": "conversions", "content": "content", "ai": "ai", "ads": "ads", "today": "today",
    "competitors": "competitors", "competitor": "competitors", "page-pairs": "competitors", "keyword-check": "competitors",
    "link-gaps": "competitors", "ai-watch": "competitors", "competitor-notes": "competitors",
    "overview": "overview", "insights": "insights", "keywords": "keywords",
    "backlinks": "backlinks", "links": "health", "health": "health", "uptime": "health",
    "tasks": "tasks", "notes": "notes", "resources": "resources", "pages": "pages", "site-page": "pages",
    # "connections" is Settings: admins only, so it is left out on purpose.
}

TRAFFIC = "channels conversions content today"
SEARCH = "overview insights keywords ai today"

ENDPOINTS: dict[str, tuple[str, str, str]] = {
    # ---- signing in, and things every screen needs ----
    "auth_api.login": ("*", "read", "free"),
    "auth_api.logout": ("*", "self", "free"),
    "auth_api.me": ("*", "read", "free"),
    "auth_api.change_password": ("*", "self", "free"),
    "auth_api.team": ("*", "read", "free"),  # names only for anyone who isn't an admin (task assignees)
    "auth_api.create_user": ("*", "admin", ""),
    "auth_api.update_user": ("*", "admin", ""),
    "auth_api.reset_password": ("*", "admin", ""),
    "logos_api.known": ("*", "read", "free"),
    "logos_api.image": ("*", "read", "free"),
    "links_api.list_own_sites": ("*", "read", "all"),
    "exports_api.views": ("*", "read", "free"),
    "exports_api.export": ("*", "read", ""),  # decided by the view id: see access._export
    # The bell: new Search Console queries, opened in Overview or Keywords.
    "notifications_api.listing": ("overview keywords social", "read", "all"),
    "notifications_api.read": ("overview keywords social", "self", ""),
    "notifications_api.read_all": ("overview keywords social", "self", "all"),

    # ---- Settings: admins only ----
    "sources_api.save_key": ("*", "admin", ""), "sources_api.remove_key": ("*", "admin", ""), "sources_api.test_key": ("*", "admin", ""),
    "sources_api.add_google": ("*", "admin", ""), "sources_api.remove_google": ("*", "admin", ""), "sources_api.test_google": ("*", "admin", ""),
    "sources_api.import_clarity_archive": ("*", "admin", ""), "sources_api.import_clarity_reports": ("*", "admin", ""),
    "sources_api.save_source": ("*", "admin", ""), "sources_api.overview": ("*", "admin", ""),
    "competitors_api.connection_save": ("*", "admin", ""), "competitors_api.connection_remove": ("*", "admin", ""),
    "keywords_api.order": ("*", "admin", ""), "keywords_api.settings": ("*", "admin", ""), "keywords_api.paid": ("*", "admin", ""),
    "keywords_api.test": ("*", "admin", ""),
    "insights_api.save_ai_settings": ("*", "admin", ""),
    "links_api.update_site": ("*", "admin", ""), "health_api.settings": ("*", "admin", ""), "uptime_api.update": ("*", "admin", ""),
    "links_api.add_site": ("*", "admin", ""),
    "metrics_api.mark_important": ("competitors", "global", "free"),
    "metrics_api.important_domains": ("competitors", "read", "free"),
    "metrics_api.get_moz": ("competitors", "gspend", "free"),
    "metrics_api.get_popularity": ("competitors", "global", "free"),

    # ---- Social: LinkedIn and X drafts ----
    # The helpers' routes never reach this table: they have no session and sign in with the site's token (seo.web.social_api).
    "social_api.bot_brief": ("*", "read", "free"), "social_api.bot_inbox": ("*", "read", "free"),
    "social_api.bot_targets": ("*", "read", "free"), "social_api.bot_stage": ("*", "read", "free"),
    "social_api.day": ("social", "read", ""),
    "social_api.settings": ("social", "read", ""),
    "social_api.update_item": ("social", "write", ""),
    "social_api.add_target": ("social", "write", ""),
    "social_api.save_guide": ("social", "write", ""),
    "social_api.upload_skill": ("social", "write", ""),
    "social_api.add_rule": ("social", "write", ""),
    "social_api.remove_rule": ("social", "write", ""),
    "social_api.answer_proposal": ("social", "write", ""),
    "social_api.add_source": ("social", "write", ""),
    "social_api.remove_source": ("social", "write", ""),
    "social_api.gather_now": ("social", "write", ""),
    "social_api.save_mailbox": ("*", "admin", ""),
    "social_api.new_token": ("*", "admin", ""),
    # Video transcripts (seo/web/social_transcripts_api.py). Finding links in text or a file touches no site.
    "social_transcripts_api.listing": ("social", "read", ""),
    "social_transcripts_api.one": ("social", "read", ""),
    "social_transcripts_api.download": ("social", "read", ""),
    "social_transcripts_api.find": ("social", "read", "free"),
    "social_transcripts_api.from_file": ("social", "read", "free"),
    "social_transcripts_api.account": ("social", "write", ""),
    "social_transcripts_api.create": ("social", "write", ""),
    "social_transcripts_api.rename": ("social", "write", ""),
    "social_transcripts_api.remove": ("social", "write", ""),
    "social_transcripts_api.retry_batch": ("social", "write", ""),
    "social_transcripts_api.retry_one": ("social", "write", ""),

    # ---- Today ----
    "metrics_api.today": ("today", "read", "all"),
    "metrics_api.today_attention": ("today", "read", "all"),
    "metrics_api.today_seen": ("today", "write", "free"),  # marks a row seen for the whole team, so it's a change

    # ---- Traffic: Channels, Conversions, Content, Google Ads ----
    "metrics_api.channels": (TRAFFIC, "read", "all"),
    "metrics_api.channel_detail": (TRAFFIC, "read", "all"),
    "metrics_api.referrer_detail": (TRAFFIC + " backlinks", "read", "all"),
    "metrics_api.page_detail": (TRAFFIC + " overview pages", "read", "all"),
    "metrics_api.assistant_detail": (TRAFFIC + " ai", "read", "all"),
    "metrics_api.conversions": (TRAFFIC, "read", "all"),
    "metrics_api.content": (TRAFFIC, "read", "all"),
    "metrics_api.overview": (TRAFFIC + " overview", "read", "all"),
    "metrics_api.clarity": (TRAFFIC + " ai", "read", "all"),
    "metrics_api.clarity_reports_latest": (TRAFFIC + " ai", "read", "all"),
    "metrics_api.speed": (TRAFFIC + " health", "read", "all"),
    "metrics_api.ads": ("ads today", "read", "all"),
    "metrics_api.ai_search": ("ai today", "read", "all"),
    "metrics_api.add_rule": ("channels conversions content ai overview", "write", ""),
    "metrics_api.delete_rule": ("channels conversions content ai overview", "write", ""),
    "metrics_api.ideas": ("keywords", "read", "free"),  # ideas for a country and language, no site's data
    "metrics_api.push_indexnow": ("health content", "write", ""),
    "metrics_api.backlink_visits": ("backlinks", "read", ""),
    "metrics_api.backlink_before_after": ("backlinks", "read", ""),
    "metrics_api.summarise_change": ("competitors today", "gspend", "free"),
    "sources_api.collect": (TRAFFIC + " overview insights keywords ai health", "write", ""),
    "sources_api.collect_jobs": ("*", "read", "free"),  # job states only, ids the page started

    # ---- Resources ----
    "metrics_api.list_resources": ("resources", "read", "all"),
    "metrics_api.create_resource": ("resources", "write", ""),
    "metrics_api.update_resource": ("resources", "write", ""),
    "metrics_api.delete_resource": ("resources", "write", ""),
    "metrics_api.restore_resource": ("resources", "write", ""),

    # ---- Search: Overview ----
    "search_api.overview": ("overview today", "read", "all"),
    "search_api.breakdown": ("overview", "read", "all"),
    "search_api.detail": ("overview keywords", "read", "all"),
    "search_api.opportunities": ("overview", "read", "all"),
    "search_api.brand": ("overview insights", "read", "all"),
    "search_api.add_brand": ("overview insights", "write", ""),
    "search_api.target_countries": ("overview insights", "read", "all"),
    "search_api.set_target_countries": ("overview insights", "write", ""),
    "search_api.add_note": ("overview", "write", ""),
    "search_api.delete_note": ("overview", "write", ""),
    "search_api.verify": ("overview", "write", ""),
    "search_api.ai_report": ("ai overview", "read", "all"),
    "search_api.upload_ai_report": ("ai", "write", ""),

    # ---- Insights ----
    "insights_api.listing": ("insights today", "read", "all"),
    "insights_api.one": ("insights today", "read", ""),
    "insights_api.dismiss": ("insights", "write", ""),
    "insights_api.run": ("insights", "write", "all"),
    "insights_api.ask_ai": ("insights", "spend", ""),
    "insights_api.ai_settings": ("insights", "read", "free"),

    # ---- Keywords and Refresh ----
    "keywords_api.listing": ("keywords competitors tasks ai today", "read", "all"),
    "keywords_api.queries": ("keywords overview", "read", "all"),
    "keywords_api.detail": ("keywords competitors overview", "read", ""),
    "keywords_api.forget": ("keywords", "write", ""),
    "keywords_api.restore": ("keywords", "write", ""),  # its keyword_id is checked through site_id (see OWNER_OVERRIDES)
    "keywords_api.preview": ("keywords competitors ai", "read", ""),
    "keywords_api.start": ("keywords competitors ai", "paid?", ""),
    "keywords_api.active": ("keywords competitors ai", "read", "all"),
    "keywords_api.run": ("keywords competitors ai", "read", ""),
    "keywords_api.cancel": ("keywords competitors ai", "write", ""),
    "keywords_api.tools": ("keywords competitors ai", "read", "free"),
    "competitors_api.connection_status": ("keywords competitors", "read", "free"),

    # ---- Competitors ----
    "competitors_api.ai_overview_watch": ("competitors ai", "read", ""),
    "competitors_api.collective_keywords": ("competitors", "read", "all"),
    "competitors_api.collective_links": ("competitors", "read", "all"),
    "competitors_api.collective_moves": ("competitors", "read", "all"),
    "competitors_api.collective_rivals": ("competitors today", "read", "all"),
    "competitors_api.list_competitors": ("competitors notes today", "read", ""),
    "competitors_api.add_competitor": ("competitors", "write", ""),
    "competitors_api.add_many_competitors": ("competitors", "write", ""),
    "competitors_api.remove_competitor": ("competitors", "write", ""),
    "competitors_api.crawl_now": ("competitors", "global", ""),
    "competitors_api.firecrawl_offer": ("competitors", "read", ""),
    "competitors_api.firecrawl_start": ("competitors", "gspend", ""),
    "competitors_api.firecrawl_weekly": ("competitors", "gspend", ""),
    "competitors_api.competitor_insights": ("competitors", "read", ""),
    "competitors_api.competitor_profile": ("competitors", "read", ""),
    "competitors_api.competitor_reading": ("competitors", "read", ""),
    "competitors_api.set_tracking": ("competitors", "write", ""),
    "competitors_api.list_suggestions": ("competitors", "read", ""),
    "competitors_api.decide_suggestion": ("competitors", "write", ""),
    "competitors_api.keyword_check": ("competitors", "read", ""),
    "competitors_api.keyword_check_estimate": ("competitors", "read", ""),
    "competitors_api.keyword_check_add": ("competitors", "write", ""),
    "competitors_api.keyword_check_remove": ("competitors", "write", ""),
    "competitors_api.keyword_check_restore": ("competitors", "write", ""),
    "competitors_api.keyword_check_track": ("competitors", "write", ""),
    "competitors_api.keyword_check_run": ("competitors", "write", ""),  # free checks only (seo/competitors/probe.py)
    "competitors_api.refresh_keywords": ("competitors", "write", ""),
    "competitors_api.keyword_run": ("competitors", "read", ""),
    "competitors_api.upload_keywords": ("competitors", "write", ""),
    "competitors_api.list_gaps": ("competitors", "read", ""),
    "competitors_api.add_gaps": ("competitors", "write", ""),
    "competitors_api.add_gap_domain": ("competitors", "global", "free"),
    "competitors_api.decide_gap": ("competitors", "write", ""),
    "competitors_api.edit_gap": ("competitors", "global", "free"),
    "competitors_api.reset_gap_edit": ("competitors", "global", "free"),
    "competitors_api.import_gaps": ("competitors", "global", ""),  # writes competitor_referrers, shared by every site following that competitor
    "competitors_api.list_pairs": ("competitors", "read", ""),
    "competitors_api.create_pair": ("competitors", "write", ""),
    "competitors_api.pick_my_page": ("competitors", "write", ""),  # Questions → Change: the site_id in the body is checked
    "competitors_api.pair_detail": ("competitors", "read", ""),
    "competitors_api.update_pair": ("competitors", "write", ""),
    "competitors_api.pair_automatic": ("competitors", "write", ""),
    "competitors_api.read_pair": ("competitors", "global", ""),  # reads the competitor's page, which every site following it shares
    "competitors_api.site_pages": ("competitors", "read", ""),
    "competitors_api.list_prospects": ("competitors backlinks", "read", "all"),
    "competitors_api.add_prospects": ("competitors backlinks", "write", ""),
    "competitors_api.update_prospect": ("competitors backlinks", "write", ""),
    "competitors_api.delete_prospect": ("competitors backlinks", "write", ""),
    "competitors_api.remove_prospects": ("competitors backlinks", "write", ""),

    # ---- Notes ----
    "competitors_api.list_notes": ("notes", "read", "all"),
    "competitors_api.note_options": ("notes", "read", "all"),
    "competitors_api.create_note": ("notes", "write", ""),
    "competitors_api.update_note": ("notes", "write", ""),
    "competitors_api.delete_note": ("notes", "write", ""),
    "competitors_api.restore_note": ("notes", "write", ""),
    "competitors_api.add_note_file": ("notes", "write", ""),
    "competitors_api.note_file": ("notes", "read", ""),
    "competitors_api.delete_note_file": ("notes", "write", ""),
    "competitors_api.restore_note_file": ("notes", "write", ""),

    # ---- Tasks ----
    "tasks_api.tasks": ("tasks today", "read", "all"),
    "tasks_api.task_options": ("tasks", "read", ""),  # what a task can be about, for one of their sites
    # The Pages screen: every page of their sites, with its Search Console and Analytics numbers (metrics.Scope keeps "all" to their sites).
    # Its Search and Visits tabs read metrics_api.page_detail, which lists "pages" among its sections.
    "pages_api.listing": ("pages", "read", "all"),
    "pages_api.profile": ("pages", "read", ""),
    "tasks_api.create": ("tasks", "write", ""),
    "tasks_api.update": ("tasks", "write", ""),
    "tasks_api.delete": ("tasks", "write", ""),
    "tasks_api.comment": ("tasks", "write", ""),
    "tasks_api.restore": ("tasks", "write", ""),

    # ---- Backlinks ----
    "competitors_api.log_backlink": ("backlinks", "write", ""),
    "competitors_api.list_backlinks": ("backlinks competitors", "read", ""),
    "competitors_api.update_backlink": ("backlinks", "write", ""),
    "competitors_api.delete_backlink": ("backlinks", "write", ""),
    "competitors_api.ignore_backlink": ("backlinks", "write", ""),
    "competitors_api.save_backlinks": ("backlinks", "write", ""),
    "backlinks_api.one": ("backlinks", "read", ""),
    "backlinks_api.check": ("backlinks", "write", ""),
    "backlinks_api.checks": ("backlinks", "read", ""),
    "backlinks_api.disavow": ("backlinks", "write", ""),
    "backlinks_api.todo_placed": ("backlinks", "write", ""),
    "backlinks_api.todo_update": ("backlinks", "write", ""),
    "backlinks_api.budget_get": ("backlinks", "read", ""),
    "backlinks_api.budget_set": ("backlinks", "write", ""),
    "backlinks_api.disavow_file": ("backlinks", "read", ""),
    "backlinks_api.gsc_import": ("backlinks", "write", ""),
    "backlinks_api.reclaim_list": ("backlinks", "read", ""),
    "backlinks_api.reclaim_dismiss": ("backlinks", "write", ""),
    "backlinks_api.summary": ("backlinks today", "read", "all"),
    "backlinks_api.todo_move": ("backlinks competitors", "write", ""),
    "backlinks_api.todo_move_back": ("backlinks", "write", ""),
    "backlinks_api.todo_sent": ("backlinks", "write", ""),
    "backlinks_api.list_mediators": ("backlinks", "read", "free"),
    "backlinks_api.create_mediator": ("backlinks", "global", "free"),
    "backlinks_api.update_mediator": ("backlinks", "global", "free"),

    # ---- Site health ----
    "health_api.alerts": ("health today", "read", "all"),
    "health_api.seen": ("health today", "write", ""),  # an alert seen is seen for the whole team
    "health_api.start": ("health", "write", ""),
    "health_api.detail": ("health", "read", ""),
    "health_api.stop": ("health", "write", ""),
    "health_api.sites": ("health", "read", "all"),
    "health_api.history": ("health", "read", ""),
    "health_api.indexing": ("health", "read", ""),
    "health_api.indexing_now": ("health", "write", ""),
    "links_api.start_scan": ("health", "write", ""),
    "links_api.scan_detail": ("health", "read", ""),
    "links_api.delete_scan": ("health", "write", ""),
    "links_api.export_scan": ("health", "read", ""),
    "links_api.stop_scan": ("health", "write", ""),
    "links_api.scan_history": ("health", "read", ""),
    "uptime_api.sites": ("health", "read", "all"),
    "uptime_api.check": ("health", "write", ""),
}
