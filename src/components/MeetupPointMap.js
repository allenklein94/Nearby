// The meet-up point pin in a gathering's attending section. Native only: the website build (the business dashboard
// registers GatheringDetail) uses MeetupPointMap.web.js, because react-native-maps has no web implementation; the
// "Get an Uber there" link below the map works on both.
import React from 'react';
import MapView, { Marker } from 'react-native-maps';

export default function MeetupPointMap({ point, color, style }) {
  return (
    <MapView
      style={style}
      initialRegion={{ latitude: point.latitude, longitude: point.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
      scrollEnabled={false}
      zoomEnabled={false}
    >
      <Marker coordinate={point} pinColor={color} />
    </MapView>
  );
}
