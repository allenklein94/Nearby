// Web-only stand-in for react-native-maps in the preview harness (the native map can't render in a browser).
import React from 'react';
import { View, Text } from 'react-native';
const MapView = React.forwardRef((props, ref) => React.createElement(View, { ref, style: [{ backgroundColor: '#dfe7e2', alignItems: 'center', justifyContent: 'center' }, props.style] }, React.createElement(Text, { style: { color: '#6b7b72' } }, 'map (not drawn in preview)')));
export const Marker = () => null; export const Callout = () => null; export const Circle = () => null; export const Polyline = () => null;
export const PROVIDER_GOOGLE = 'google'; export const PROVIDER_DEFAULT = null;
export default MapView;
