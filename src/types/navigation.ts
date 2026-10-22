import type { NavigatorScreenParams } from '@react-navigation/native';
import type { JourneySetup } from '../schemas/journey';
import type { JourneyStatus } from './db';

export type AuthStackParamList = {
  SignIn: undefined;
  ResetPassword: undefined;
};

export type StaffTabParamList = {
  Home: undefined;
  History: undefined;
  Settings: undefined;
};

export type StaffStackParamList = {
  StaffTabs: NavigatorScreenParams<StaffTabParamList>;
  StartJourney: undefined;
  JourneySetup: undefined;
  Consent: { setup: JourneySetup };
  ActiveJourney: undefined;
  SOSStatus: { clientRequestId: string };
  JourneyCompleted: { journeyId: string; status: JourneyStatus; confirmed: boolean };
  JourneyDetails: { journeyId: string };
  Profile: undefined;
  Privacy: undefined;
  NotificationPrefs: undefined;
  Troubleshooting: undefined;
};

export type AdminTabParamList = {
  Dashboard: undefined;
  Journeys: undefined;
  Alerts: undefined;
  Staff: undefined;
  More: undefined;
};

export type AdminStackParamList = {
  AdminTabs: NavigatorScreenParams<AdminTabParamList>;
  LiveMap: undefined;
  AdminJourneyDetail: { journeyId: string };
  SOSDetail: { alertId: string };
  EmployeeDetail: { userId: string };
  InviteEmployee: undefined;
  AuditLog: undefined;
  NotificationFailures: undefined;
  AdminProfile: undefined;
};
