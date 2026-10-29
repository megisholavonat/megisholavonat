POSITIONS_QUERY = """
  query Positions {
    vehiclePositions(
      neLat: 51.33061163769853
      neLon: 25.0927734375
      swLat: 44.96479793033104
      swLon: 8.833007812500002
      modes: [RAIL, TRAMTRAIN, SUBURBAN_RAILWAY]
    ) {
      vehicleId
      lat
      lon
      heading
      speed
      lastUpdated
      trip {
        gtfsId
        stoptimes {
          stopPosition
          scheduledArrival
          realtimeArrival
          scheduledDeparture
          realtimeDeparture
          realtimeState
          stop {
            gtfsId
            stationUicPricingCode
            name
            lat
            lon
            platformCode
          }
        }
        serviceDate
        tripShortName
        route {
          mode
          textColor
          shortName
          longName
        }
        tripGeometry {
          points
        }
        wheelchairAccessible
        bikesAllowed
        infoServices {
          name
          fromStopIndex
          tillStopIndex
          fontCharSet
          fontCode
          displayable
        }
        alerts {
          alertDescriptionText
          alertUrl
          effectiveStartDate
          effectiveEndDate
        }
      }
    }
  }
"""

# Every station of every feed. Rail stations are filtered out of this when
# building the search index.
STATIONS_QUERY = """
  query Stations {
    stations {
      gtfsId
      name
      lat
      lon
      vehicleMode
    }
  }
"""

# A station's board, merged across its platforms. `numberOfDepartures` is
# applied per pattern, so asking for N per pattern guarantees that the first N
# overall are included.
STATION_BOARD_QUERY = """
  query StationBoard(
    $id: String!
    $n: Int!
    $range: Int!
    $omitNonPickups: Boolean!
  ) {
    station(id: $id) {
      gtfsId
      name
      lat
      lon
      stoptimesWithoutPatterns(
        numberOfDepartures: $n
        timeRange: $range
        omitNonPickups: $omitNonPickups
        omitCanceled: false
      ) {
        scheduledArrival
        realtimeArrival
        scheduledDeparture
        realtimeDeparture
        realtime
        realtimeState
        pickupType
        dropoffType
        headsign
        serviceDay
        stop {
          platformCode
        }
        trip {
          gtfsId
          tripShortName
          tripHeadsign
          route {
            shortName
            longName
            textColor
          }
          alerts {
            alertDescriptionText
            effectiveStartDate
            effectiveEndDate
          }
          # Where a notice about part of the run applies
          stops {
            gtfsId
            name
          }
          departureStoptime {
            scheduledDeparture
            stop {
              name
            }
          }
        }
      }
    }
  }
"""

# Alerts of the given feeds. Feed "1" holds every railway (MÁV, GYSEV, HÉV
# and foreign operators).
ALERTS_QUERY = """
  query Alerts($feeds: [String!]) {
    alerts(feeds: $feeds) {
      id
      feed
      alertHeaderText
      alertDescriptionText
      alertUrl
      effectiveStartDate
      effectiveEndDate
      entities {
        __typename
        ... on Route {
          gtfsId
          mode
          shortName
          longName
        }
        ... on Trip {
          gtfsId
          tripShortName
          route {
            gtfsId
            mode
            shortName
            longName
          }
        }
        ... on Stop {
          gtfsId
          name
          parentStation {
            gtfsId
            name
          }
        }
        ... on StopOnRoute {
          stop {
            gtfsId
            name
            parentStation {
              gtfsId
              name
            }
          }
          route {
            gtfsId
            mode
            shortName
            longName
          }
        }
      }
    }
  }
"""

# One trip's stops on one service date (YYYYMMDD), with their realtime state,
# and its alerts: the timetable side of a run's delay summary
RUN_TRIP_QUERY = """
  query RunTrip($id: String!, $date: String!) {
    trip(id: $id) {
      gtfsId
      tripShortName
      route {
        shortName
      }
      stoptimesForDate(serviceDate: $date) {
        scheduledArrival
        scheduledDeparture
        realtimeState
        stop {
          gtfsId
          stationUicPricingCode
          name
        }
      }
      alerts {
        alertDescriptionText
      }
    }
  }
"""

# Journeys between two rail stations. Upstream only supports the legacy `plan`
# query (`planConnection` fails). Places are parent stations (`1:<UIC>`), so
# no walk to or from the station is added. Times are in ms, delays in s.
# RAIL_REPLACEMENT_BUS is MÁV's own mode; plain BUS would let city and
# regional buses replace trains.
JOURNEYS_QUERY = """
  query Journeys(
    $from: String!
    $to: String!
    $date: String!
    $time: String!
    $arriveBy: Boolean!
    $n: Int!
  ) {
    plan(
      fromPlace: $from
      toPlace: $to
      date: $date
      time: $time
      arriveBy: $arriveBy
      numItineraries: $n
      # Without it, train categories come in English ("passenger train")
      # unlike everywhere else, and live trains match by gtfsId only
      locale: "hu"
      transportModes: [
        { mode: RAIL }
        { mode: SUBURBAN_RAILWAY }
        { mode: TRAMTRAIN }
        { mode: RAIL_REPLACEMENT_BUS }
        { mode: WALK }
      ]
    ) {
      itineraries {
        legs {
          mode
          startTime
          endTime
          departureDelay
          arrivalDelay
          realTime
          realtimeState
          distance
          interlineWithPreviousLeg
          serviceDate
          headsign
          from {
            name
            lat
            lon
            stop {
              platformCode
              stationUicPricingCode
            }
          }
          to {
            name
            lat
            lon
            stop {
              platformCode
              stationUicPricingCode
            }
          }
          route {
            shortName
            longName
            textColor
          }
          trip {
            gtfsId
            tripShortName
            departureStoptime {
              scheduledDeparture
            }
          }
          intermediateStops {
            gtfsId
          }
        }
      }
    }
  }
"""

# Stops in a bounding box with the codes of the patterns calling there; the
# first step of building the map's rail network
MAP_PATTERN_CODES_QUERY = """
  query MapPatternCodes(
    $minLat: Float!
    $minLon: Float!
    $maxLat: Float!
    $maxLon: Float!
  ) {
    stopsByBbox(
      minLat: $minLat
      minLon: $minLon
      maxLat: $maxLat
      maxLon: $maxLon
      feeds: ["1"]
    ) {
      vehicleMode
      patterns {
        code
      }
    }
  }
"""

# Fields of one pattern for the map's rail network. The query selecting a
# batch of patterns by code is built around it (api.services.map_layers).
MAP_PATTERN_FRAGMENT = """
  fragment MapPattern on Pattern {
    route {
      mode
      agency {
        name
      }
    }
    patternGeometry {
      points
    }
    tripsForDate(serviceDate: $date) {
      id
    }
  }
"""
