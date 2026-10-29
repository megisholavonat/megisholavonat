"""
SQL fragments over stop_delay_observations shared by the history readers
(statistics, connection risk, run summaries) and the daily rollup.
"""

from datetime import date
from typing import Any

from api.util.history_constants import ON_TIME_THRESHOLD_S

# Train numbers are the first word of the trip short name ("10 TRANSCARPATHIA");
# the SQL twin of api.util.trip.train_number
TRAIN_NUMBER = "split_part(trip_short_name, ' ', 1)"
# The service dates of a history window, bound by `window_params`
IN_WINDOW = "service_date BETWEEN :start AND :end"
# A passage on time, bound by ON_TIME_PARAMS
ON_TIME = "delay_s <= :on_time"
ON_TIME_PARAMS: dict[str, Any] = {"on_time": ON_TIME_THRESHOLD_S}

# Delay aggregates over a set of observations
DELAY_AGGREGATES = f"""
    count(*) AS n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY delay_s) AS median_s,
    percentile_cont(0.8) WITHIN GROUP (ORDER BY delay_s) AS p80_s,
    avg(({ON_TIME})::int) AS on_time_share
"""


def window_params(start: date, end: date) -> dict[str, Any]:
    """Bind parameters of IN_WINDOW and ON_TIME."""
    return {"start": start, "end": end, **ON_TIME_PARAMS}
