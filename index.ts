import { registerRootComponent } from 'expo';
// Defines the background location task at the top level of the bundle. Android may start the
// app headlessly for location updates, in which case no React component mounts.
import './src/services/location/locationTask';
import App from './App';

registerRootComponent(App);
