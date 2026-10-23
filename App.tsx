/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bus, BusStop, Language, Ticket, SensorLogEvent, OccupancyStatus } from './types/transit';
import { BENGALURU_STOPS, INITIAL_BUSES, SAMPLE_INITIAL_TICKETS } from './data/mockTransitData';
import { BMTC_VERIFIED_STOPS } from './data/bmtcStopsData';
import { fetchLiveBusesFromBackend, fetchBmtcStopsFromBackend, getBackendBaseUrl, setBackendBaseUrl } from './services/bookingApi';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { HomeView } from './components/HomeView';
import { BusSearchView } from './components/BusSearchView';
import { BookingView } from './components/BookingView';
import { QrTicketView } from './components/QrTicketView';
import { LiveTrackingView } from './components/LiveTrackingView';
import { CapacityDashboardView } from './components/CapacityDashboardView';
import { PassengerInfoView } from './components/PassengerInfoView';
import { KioskModeModal } from './components/KioskModeModal';
import { RefreshCw, Server, CheckCircle2, AlertCircle, MapPin, Settings, X, ExternalLink, HelpCircle } from 'lucide-react';

export default function App() {
  // Navigation & Language
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [language, setLanguage] = useState<Language>('en');

  // Journey query state
  const [originStopId, setOriginStopId] = useState<string>('stop_majestic');
  const [destStopId, setDestStopId] = useState<string>('stop_electronic_city');
  const [travelDate, setTravelDate] = useState<string>('2026-10-23');

  // Core Data & State
  const [stops, setStops] = useState<BusStop[]>(BMTC_VERIFIED_STOPS);
  const [isStopsFromBackend, setIsStopsFromBackend] = useState<boolean>(false);
  const [buses, setBuses] = useState<Bus[]>(INITIAL_BUSES);
  const [tickets, setTickets] = useState<Ticket[]>(SAMPLE_INITIAL_TICKETS);
  const [activeTicketId, setActiveTicketId] = useState<string>(SAMPLE_INITIAL_TICKETS[0].id);

  // FastAPI Backend Connection State
  const [isBackendLive, setIsBackendLive] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Active selections for specific modules
  const [selectedBusForBooking, setSelectedBusForBooking] = useState<Bus | null>(null);
  const [activeBusForCapacity, setActiveBusForCapacity] = useState<string>(INITIAL_BUSES[0].id);
  const [activeRouteForTracking, setActiveRouteForTracking] = useState<string>('356-M');

  // Kiosk Terminal Modal state
  const [isKioskOpen, setIsKioskOpen] = useState<boolean>(false);

  // Real-time sensor log events
  const [sensorLogs, setSensorLogs] = useState<SensorLogEvent[]>([
    {
      id: 'log_init_1',
      timestamp: '10:42:10 AM',
      door: 'Front (Entry)',
      action: 'board',
      count: 2,
      stopName: 'Silk Board Junction',
      currentOccupancy: 34,
    },
    {
      id: 'log_init_2',
      timestamp: '10:38:45 AM',
      door: 'Rear (Exit)',
      action: 'exit',
      count: 3,
      stopName: 'BTM Layout',
      currentOccupancy: 32,
    },
  ]);

  // Sync buses from FastAPI GET /buses (Feature 1, 6, 9)
  const syncBusesFromBackend = useCallback(async () => {
    setIsRefreshing(true);
    const result = await fetchLiveBusesFromBackend();
    setIsRefreshing(false);

    if (result.isLive && result.buses.length > 0) {
      // Feature 9: Do not use mock bus data when the backend is available
      setBuses(result.buses);
      setIsBackendLive(true);
      setLastSyncedAt(new Date());

      // If user is currently looking at a bus in booking, keep it updated
      setSelectedBusForBooking((prev) => {
        if (!prev) return null;
        const updated = result.buses.find((b) => b.id === prev.id || b.routeNumber === prev.routeNumber);
        return updated || prev;
      });
    } else {
      setIsBackendLive(false);
    }
  }, []);

  // Feature 6: Refresh bus information every 5 seconds
  useEffect(() => {
    syncBusesFromBackend();

    const intervalId = setInterval(() => {
      syncBusesFromBackend();
    }, 5000);

    return () => clearInterval(intervalId);
  }, [syncBusesFromBackend]);

  // Load BMTC stops dynamically from backend GET /stops if endpoint exists
  useEffect(() => {
    const loadDynamicStops = async () => {
      const res = await fetchBmtcStopsFromBackend();
      if (res.isLiveFromBackend && res.stops.length > 0) {
        setStops(res.stops);
        setIsStopsFromBackend(true);
      }
    };
    loadDynamicStops();
  }, []);

  // Dynamically load Google Maps Platform SDK when API Key is configured
  useEffect(() => {
    const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!mapsApiKey || (window as any).google?.maps) return;

    const existingScript = document.getElementById('google-maps-sdk');
    if (!existingScript) {
      const script = document.createElement('script');
      script.id = 'google-maps-sdk';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=places,geometry&loading=async`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, []);


  // Helper to recompute bus status badge
  const calculateStatus = (current: number, max: number): OccupancyStatus => {
    const ratio = current / max;
    if (ratio >= 0.95) return 'full';
    if (ratio >= 0.70) return 'limited';
    return 'available';
  };

  // Handler for manual capacity simulation in dashboard
  const handleUpdatePassengerCount = (
    busId: string,
    newCount: number,
    event?: { action: 'board' | 'exit'; count: number; door: 'Front (Entry)' | 'Rear (Exit)' }
  ) => {
    setBuses((prevBuses) =>
      prevBuses.map((b) => {
        if (b.id === busId) {
          const boundedCount = Math.max(0, Math.min(b.maxCapacity, newCount));
          const newStatus = calculateStatus(boundedCount, b.maxCapacity);

          // Update seats and standing estimates
          const newOccupiedSeats = Math.min(40, boundedCount);
          const newAvailableSeats = Math.max(0, 40 - newOccupiedSeats);
          const newStanding = Math.max(0, boundedCount - 40);
          const newAvailableStanding = Math.max(0, 20 - newStanding);
          const isFullNow = boundedCount >= b.maxCapacity || (newAvailableSeats <= 0 && newAvailableStanding <= 0);

          if (event) {
            const newLog: SensorLogEvent = {
              id: `log_${Date.now()}_${Math.random()}`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              door: event.door,
              action: event.action,
              count: event.count,
              stopName: stops.find((s) => s.id === b.currentStopId)?.nameEn || 'Bengaluru Corridor',
              currentOccupancy: boundedCount,
            };
            setSensorLogs((prev) => [newLog, ...prev.slice(0, 24)]);
          }

          return {
            ...b,
            currentPassengers: boundedCount,
            occupiedSeats: newOccupiedSeats,
            availableSeats: newAvailableSeats,
            standingPassengers: newStanding,
            availableStandingSpaces: newAvailableStanding,
            isFull: isFullNow,
            status: isFullNow ? 'full' : newStatus,
          };
        }
        return b;
      })
    );
  };

  // Handler for updating bus max capacity configuration
  const handleUpdateBusCapacity = (busId: string, newCapacity: number) => {
    setBuses((prevBuses) =>
      prevBuses.map((b) => {
        if (b.id === busId) {
          const newStatus = calculateStatus(b.currentPassengers, newCapacity);
          return {
            ...b,
            maxCapacity: newCapacity,
            totalCapacity: newCapacity,
            status: newStatus,
          };
        }
        return b;
      })
    );
  };

  // Select a bus from search or home and open booking
  const handleSelectBusForBooking = (bus: Bus) => {
    setSelectedBusForBooking(bus);
    setCurrentTab('booking');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Successful booking handler
  const handleBookingSuccess = (newTicket: Ticket) => {
    setTickets((prev) => [newTicket, ...prev]);
    setActiveTicketId(newTicket.id);

    // Refresh buses from backend immediately to catch server-side seat decrements
    syncBusesFromBackend();

    // Switch to QR Ticket View
    setCurrentTab('ticket');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Conductor Scan simulation handler
  const handleMarkTicketScanned = (ticketId: string) => {
    setTickets((prev) =>
      prev.map((t) => {
        if (t.id === ticketId) {
          return {
            ...t,
            status: 'BOARDED',
            scannedAt: new Date().toISOString(),
          };
        }
        return t;
      })
    );
  };

  // Kiosk ticket generation handler
  const handleGenerateKioskTicket = (ticket: Ticket) => {
    setTickets((prev) => [ticket, ...prev]);
    setActiveTicketId(ticket.id);
  };

  // Navigation shortcuts
  const handleNavigateToTracking = (routeNumber: string) => {
    setActiveRouteForTracking(routeNumber);
    setCurrentTab('liveTrack');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavigateToCapacity = (busId: string) => {
    setActiveBusForCapacity(busId);
    setCurrentTab('capacity');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-emerald-500 selection:text-white">
      {/* Top Header Navigation */}
      <Header
        currentTab={currentTab}
        setCurrentTab={(tab) => {
          setCurrentTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        language={language}
        setLanguage={setLanguage}
        ticketCount={tickets.length}
        onOpenKiosk={() => setIsKioskOpen(true)}
      />

      {/* FastAPI Backend Status Banner (Live Polling every 5s) */}
      <div className={`border-b text-xs py-1.5 px-4 transition-colors ${
        isBackendLive
          ? 'bg-emerald-900 text-emerald-100 border-emerald-800'
          : 'bg-slate-800 text-slate-200 border-slate-700'
      }`}>
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Server className={`w-3.5 h-3.5 ${isBackendLive ? 'text-emerald-400' : 'text-amber-400'}`} />
            {isBackendLive ? (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <strong className="font-semibold text-emerald-300">FastAPI Live Backend Connected</strong>
                <span>(GET /buses &amp; POST /bookings active at {getBackendBaseUrl()})</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-slate-300">FastAPI Backend ({getBackendBaseUrl()}):</span>
                <span className="text-amber-300">Connecting... (Refreshing every 5s)</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/20 text-slate-300">
              <MapPin className="w-3 h-3 text-emerald-400" />
              <span>{stops.length} Stops ({isStopsFromBackend ? 'FastAPI /stops' : 'Verified Dataset'})</span>
            </div>
            {lastSyncedAt && (
              <span className="text-slate-300 font-mono-numbers">
                Last synced: {lastSyncedAt.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={syncBusesFromBackend}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              title="Refresh GET /buses now"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Tab 1: Home View */}
        {currentTab === 'home' && (
          <HomeView
            stops={stops}
            buses={buses}
            originStopId={originStopId}
            destStopId={destStopId}
            travelDate={travelDate}
            setOriginStopId={setOriginStopId}
            setDestStopId={setDestStopId}
            setTravelDate={setTravelDate}
            onSearchBuses={() => {
              setCurrentTab('search');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onSelectBusForBooking={handleSelectBusForBooking}
            onNavigateToTracking={handleNavigateToTracking}
            onNavigateToCapacity={handleNavigateToCapacity}
            onOpenKiosk={() => setIsKioskOpen(true)}
            language={language}
          />
        )}

        {/* Tab 2: Bus Search View */}
        {currentTab === 'search' && (
          <BusSearchView
            stops={stops}
            buses={buses}
            originStopId={originStopId}
            destStopId={destStopId}
            travelDate={travelDate}
            setOriginStopId={setOriginStopId}
            setDestStopId={setDestStopId}
            setTravelDate={setTravelDate}
            onSelectBusForBooking={handleSelectBusForBooking}
            onNavigateToTracking={handleNavigateToTracking}
            onNavigateToCapacity={handleNavigateToCapacity}
            language={language}
          />
        )}

        {/* Tab 3: Booking View */}
        {currentTab === 'booking' && selectedBusForBooking && (
          <BookingView
            bus={selectedBusForBooking}
            stops={stops}
            originStopId={originStopId}
            destStopId={destStopId}
            travelDate={travelDate}
            onCancel={() => setCurrentTab('search')}
            onBookingSuccess={handleBookingSuccess}
            language={language}
          />
        )}

        {/* Fallback if user navigates to booking without bus */}
        {currentTab === 'booking' && !selectedBusForBooking && (
          <BusSearchView
            stops={stops}
            buses={buses}
            originStopId={originStopId}
            destStopId={destStopId}
            travelDate={travelDate}
            setOriginStopId={setOriginStopId}
            setDestStopId={setDestStopId}
            setTravelDate={setTravelDate}
            onSelectBusForBooking={handleSelectBusForBooking}
            onNavigateToTracking={handleNavigateToTracking}
            onNavigateToCapacity={handleNavigateToCapacity}
            language={language}
          />
        )}

        {/* Tab 4: QR Ticket View (Active Ticket or My Tickets) */}
        {(currentTab === 'ticket' || currentTab === 'myTickets') && (
          <QrTicketView
            tickets={tickets}
            activeTicketId={activeTicketId}
            onNavigateHome={() => setCurrentTab('home')}
            onNavigateSearch={() => setCurrentTab('search')}
            onMarkTicketScanned={handleMarkTicketScanned}
            language={language}
          />
        )}

        {/* Tab 5: Live Bus Tracking View */}
        {currentTab === 'liveTrack' && (
          <LiveTrackingView
            buses={buses}
            stops={stops}
            initialRouteNumber={activeRouteForTracking}
            language={language}
          />
        )}

        {/* Tab 6: Passenger Capacity Dashboard (IoT Sensor Module) */}
        {currentTab === 'capacity' && (
          <CapacityDashboardView
            buses={buses}
            stops={stops}
            activeBusId={activeBusForCapacity}
            setActiveBusId={setActiveBusForCapacity}
            onUpdatePassengerCount={handleUpdatePassengerCount}
            onUpdateBusCapacity={handleUpdateBusCapacity}
            sensorLogs={sensorLogs}
            language={language}
          />
        )}

        {/* Tab 7: Passenger Information View */}
        {currentTab === 'passengerInfo' && (
          <PassengerInfoView language={language} />
        )}
      </main>

      {/* Self-Service Bus Stop Kiosk Modal */}
      <KioskModeModal
        isOpen={isKioskOpen}
        onClose={() => setIsKioskOpen(false)}
        buses={buses}
        stops={stops}
        onGenerateKioskTicket={handleGenerateKioskTicket}
        language={language}
      />

      {/* Footer */}
      <Footer
        language={language}
        onNavigate={(tab) => {
          setCurrentTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}
