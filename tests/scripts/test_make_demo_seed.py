from datetime import date

from scripts.make_demo_seed import build_demo_health_data, build_seed_sql

DAILY_KEYS = {
    "date", "steps", "resting_hr", "hrv", "sleep_hours",
    "active_calories", "exercise_minutes", "spo2",
}


def test_is_deterministic():
    assert build_demo_health_data() == build_demo_health_data()


def test_daily_shape_and_length():
    data = build_demo_health_data(days=30, end=date(2026, 9, 30))
    assert len(data["daily"]) == 30
    assert "2026-09-30" in data["daily"] and "2026-09-01" in data["daily"]
    for key, entry in data["daily"].items():
        assert set(entry) == DAILY_KEYS and entry["date"] == key


def test_values_are_plausible():
    for entry in build_demo_health_data()["daily"].values():
        assert 1000 <= entry["steps"] <= 30000
        assert 4 <= entry["sleep_hours"] <= 10
        assert 40 <= entry["resting_hr"] <= 90
        assert 0 < entry["hrv"] < 150


def test_summary_matches_daily():
    data = build_demo_health_data()
    daily = list(data["daily"].values())
    s = data["summary"]
    assert s["total_days"] == len(daily)
    assert s["best_sleep"] == max(d["sleep_hours"] for d in daily)
    assert s["worst_sleep"] == min(d["sleep_hours"] for d in daily)
    assert s["best_steps_day"] == max(daily, key=lambda d: d["steps"])["date"]
    assert s["avg_steps"] == round(sum(d["steps"] for d in daily) / len(daily))


def test_events_are_labeled_as_sample_data():
    data = build_demo_health_data()
    assert data["events"] and all("Sample" in e["label"] for e in data["events"])
    assert {"label", "start", "end", "color", "icon"} <= set(data["events"][0])


def test_seed_sql_is_an_idempotent_demo_upsert():
    sql = build_seed_sql({"note": "it's fine"})
    assert "insert into public.health_data (is_demo, data)" in sql
    assert "on conflict (is_demo) where is_demo do update" in sql
    assert "it''s fine" in sql  # single quotes escaped
