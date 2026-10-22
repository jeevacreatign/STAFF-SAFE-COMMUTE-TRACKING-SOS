import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';
import type { JourneyStatus, LocationFreshness, SosStatus } from '../types/db';
import { freshnessLabel } from '../utils/freshness';

function Badge({ text, bg, fg, testID }: { text: string; bg: string; fg: string; testID?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]} testID={testID} accessible accessibilityLabel={text}>
      <Text style={[styles.text, { color: fg }]}>{text}</Text>
    </View>
  );
}

export const journeyStatusLabel: Record<JourneyStatus, string> = {
  active: 'Active',
  safely_arrived: 'Safely arrived',
  stopped: 'Stopped',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export function JourneyStatusBadge({ status }: { status: JourneyStatus }) {
  const map: Record<JourneyStatus, [string, string]> = {
    active: [colors.navy, '#FFFFFF'],
    safely_arrived: [colors.safeLight, colors.safe],
    stopped: [colors.neutralBadge, colors.text],
    expired: [colors.warningBg, colors.warning],
    cancelled: [colors.neutralBadge, colors.textMuted],
  };
  const [bg, fg] = map[status];
  return <Badge text={journeyStatusLabel[status]} bg={bg} fg={fg} testID={`journey-status-${status}`} />;
}

export const sosStatusLabel: Record<SosStatus, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  responding: 'Responding',
  resolved: 'Resolved',
  closed: 'Closed',
};

export function SosStatusBadge({ status }: { status: SosStatus }) {
  const map: Record<SosStatus, [string, string]> = {
    new: [colors.danger, '#FFFFFF'],
    acknowledged: [colors.warningBg, colors.warning],
    responding: [colors.warningBg, colors.warning],
    resolved: [colors.safeLight, colors.safe],
    closed: [colors.neutralBadge, colors.textMuted],
  };
  const [bg, fg] = map[status];
  return <Badge text={sosStatusLabel[status]} bg={bg} fg={fg} testID={`sos-status-${status}`} />;
}

export function FreshnessBadge({ freshness }: { freshness: LocationFreshness }) {
  const map: Record<LocationFreshness, [string, string]> = {
    fresh: [colors.safeLight, colors.safe],
    delayed: [colors.warningBg, colors.warning],
    stale: [colors.dangerLight, colors.dangerDark],
    none: [colors.neutralBadge, colors.textMuted],
  };
  const [bg, fg] = map[freshness];
  return <Badge text={freshnessLabel[freshness]} bg={bg} fg={fg} testID={`freshness-${freshness}`} />;
}

const styles = StyleSheet.create({
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  text: { fontSize: 13, fontWeight: '700' },
});
