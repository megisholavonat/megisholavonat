POSITIONS_QUERY = """
  query Positions {
    vehiclePositions(
      neLat: 48.6238540716
      neLon: 22.710531447
      swLat: 45.7594811061
      swLon: 16.2022982113
      modes: [RAIL, TRAMTRAIN, SUBURBAN_RAILWAY]
    ) {
      vehicleId
      lat
      lon
      heading
      speed
      lastUpdated
      trip {
        stoptimes {
          scheduledArrival
          realtimeArrival
          scheduledDeparture
          realtimeDeparture
          stop {
            name
            lat
            lon
            platformCode
          }
        }
        serviceDate
        tripShortName
        route {
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
