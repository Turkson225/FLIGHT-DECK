import {createRoot} from 'react-dom/client';
import FlightDeck from './components/flight-deck';
import {AuthGate} from './components/auth-gate';
import './app/globals.css';
createRoot(document.getElementById('root')!).render(<AuthGate><FlightDeck/></AuthGate>);
