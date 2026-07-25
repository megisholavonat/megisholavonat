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
