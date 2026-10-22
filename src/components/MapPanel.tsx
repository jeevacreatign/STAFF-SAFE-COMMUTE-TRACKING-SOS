import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { config } from '../constants/config';
import { colors, radius, spacing, typography } from '../theme';
import type { LocationFreshness } from '../types/db';
import { AppButton } from './AppButton';

export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  title: string;
  description?: string;
  freshness: LocationFreshness;
}

const markerColor: Record<LocationFreshness, string> = {
  fresh: colors.safe,
  delayed: '#E0A100',
  stale: colors.danger,
  none: colors.textMuted,
};

export function openInMaps(lat: number, lng: number, label: string) {
  const q = encodeURIComponent(label);
  return Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}(${q})`).catch(() =>
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`),
  );
}

/**
 * Map with freshness-coloured markers. Without a configured Google Maps key, shows the
 * coordinates and an "open in maps" action instead of a broken map.
 */
export function MapPanel({ points, height = 260, onSelect, emptyText = 'No location to show yet.' }: {
  points: MapPoint[];
  height?: number;
  onSelect?: (id: string) => void;
  emptyText?: string;
}) {
  if (points.length === 0) {
    return (
      <View style={[styles.fallback, { minHeight: 100 }]}>
        <Text style={typography.bodyMuted}>{emptyText}</Text>
      </View>
    );
  }
  if (!config.mapsConfigured) {
    return (
      <View style={styles.fallback} testID="map-fallback">
        <Text style={typography.small}>Map unavailable: no Google Maps key configured for this build.</Text>
        {points.slice(0, 5).map((p) => (
          <View key={p.id} style={styles.row}>
            <Text style={typography.body}>{p.title}</Text>
            <Text style={typography.small}>{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</Text>
            <AppButton title="Open in maps" variant="secondary" onPress={() => openInMaps(p.latitude, p.longitude, p.title)} />
          </View>
        ))}
      </View>
    );
  }
  const first = points[0];
  return (
    <View style={[styles.mapWrap, { height }]}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: first.latitude, longitude: first.longitude, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        accessibilityLabel="Map of shared locations"
      >
        {points.map((p) => (
          <React.Fragment key={p.id}>
            <Marker
              coordinate={{ latitude: p.latitude, longitude: p.longitude }}
              title={p.title}
              description={p.description}
              pinColor={markerColor[p.freshness]}
              onCalloutPress={onSelect ? () => onSelect(p.id) : undefined}
            />
            {p.accuracyM ? (
              <Circle center={{ latitude: p.latitude, longitude: p.longitude }} radius={p.accuracyM} strokeColor={markerColor[p.freshness]} fillColor="rgba(27,42,74,0.08)" />
            ) : null}
          </React.Fragment>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: { borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  fallback: {
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.navyLight,
    padding: spacing.lg, marginBottom: spacing.md, gap: spacing.sm, justifyContent: 'center',
  },
  row: { gap: 4, paddingVertical: spacing.sm },
});
