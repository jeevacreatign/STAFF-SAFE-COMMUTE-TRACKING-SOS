import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';

jest.mock('../../src/services/supabase/rpc', () => ({ rpc: jest.fn(), unwrap: jest.fn() }));
jest.mock('../../src/services/supabase/client', () => ({ supabase: {} }));
jest.mock('../../src/services/journeys/journeyService', () => ({ startJourney: jest.fn() }));

import { SOSButton, SOS_HOLD_MS } from '../../src/components/SOSButton';
import { ConsentScreen } from '../../src/screens/journey/ConsentScreen';
import { startJourney } from '../../src/services/journeys/journeyService';
import { SafeAreaProvider } from 'react-native-safe-area-context';

describe('SOSButton', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('activates only after a full press-and-hold', async () => {
    const onActivate = jest.fn();
    await render(<SOSButton onActivate={onActivate} onAccessibleActivate={jest.fn()} />);
    const btn = screen.getByTestId('sos-button');
    await fireEvent(btn, 'pressIn');
    await act(async () => void jest.advanceTimersByTime(SOS_HOLD_MS - 300));
    await fireEvent(btn, 'pressOut');
    expect(onActivate).not.toHaveBeenCalled();

    await fireEvent(btn, 'pressIn');
    await act(async () => void jest.advanceTimersByTime(SOS_HOLD_MS + 100));
    expect(onActivate).toHaveBeenCalledTimes(1);
    await act(async () => void jest.advanceTimersByTime(3000));
    expect(onActivate).toHaveBeenCalledTimes(1); // no repeat while still held
  });

  test('accessibility action opens the confirmation path', async () => {
    const onA11y = jest.fn();
    await render(<SOSButton onActivate={jest.fn()} onAccessibleActivate={onA11y} />);
    await fireEvent(screen.getByTestId('sos-button'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onA11y).toHaveBeenCalled();
  });
});

describe('ConsentScreen', () => {
  const setup = { label: 'Commute home', destination: undefined, expiryMinutes: 90 };
  const nav = { reset: jest.fn(), popToTop: jest.fn(), navigate: jest.fn() };
  const renderConsent = () =>
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ConsentScreen navigation={nav as any} route={{ key: 'c', name: 'Consent', params: { setup } } as any} />
      </SafeAreaProvider>,
    );

  beforeEach(() => jest.clearAllMocks());

  test('shows purpose, audience, duration and the voluntary nature before anything is requested', async () => {
    await renderConsent();
    expect(screen.getByText('Why location is needed')).toBeTruthy();
    expect(screen.getByText('Who can see it')).toBeTruthy();
    expect(screen.getByText('How to stop')).toBeTruthy();
    expect(screen.getByText('Saying no')).toBeTruthy();
    expect(screen.getByTestId('consent-duration')).toBeTruthy();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  test('approve does nothing until the employee ticks consent', async () => {
    await renderConsent();
    await (fireEvent.press(screen.getByTestId('approve-consent')));
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(startJourney).not.toHaveBeenCalled();
  });

  test('decline returns home without requesting permission or creating a journey', async () => {
    await renderConsent();
    await (fireEvent.press(screen.getByTestId('decline-consent')));
    expect(nav.popToTop).toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(startJourney).not.toHaveBeenCalled();
  });

  test('after consent: permission, then journey creation with consent=true', async () => {
    (startJourney as jest.Mock).mockResolvedValue({ journey: { id: 'j1' }, background: true });
    await renderConsent();
    await (fireEvent(screen.getByRole('switch'), 'valueChange', true));
    await (fireEvent.press(screen.getByTestId('approve-consent')));
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
    expect(startJourney).toHaveBeenCalledWith(setup, expect.any(String), true);
    expect(nav.reset).toHaveBeenCalled();
  });

  test('foreground permission denied: no journey created', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
    await renderConsent();
    await (fireEvent(screen.getByRole('switch'), 'valueChange', true));
    await (fireEvent.press(screen.getByTestId('approve-consent')));
    expect(startJourney).not.toHaveBeenCalled();
    expect(screen.getByText('Location permission needed')).toBeTruthy();
  });

  test('background not granted: offers foreground-only sharing without blocking', async () => {
    (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied', canAskAgain: true });
    (startJourney as jest.Mock).mockResolvedValue({ journey: { id: 'j1' }, background: false });
    await renderConsent();
    await (fireEvent(screen.getByRole('switch'), 'valueChange', true));
    await (fireEvent.press(screen.getByTestId('approve-consent')));
    expect(startJourney).not.toHaveBeenCalled();
    await (fireEvent.press(screen.getByTestId('foreground-only')));
    expect(startJourney).toHaveBeenCalledTimes(1);
  });
});
