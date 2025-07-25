
import React, { useEffect, useState, useRef } from "react";
import { GoogleMap, LoadScript, Marker, } from "@react-google-maps/api";
import axios from "axios";
import "./App.css";
import { useLocation } from "react-router-dom";

const containerStyle = {
  width: "100%",
  height: "100%"
};

// Utility functions for localStorage
const getStoredLocation = () => {
  const stored = localStorage.getItem('lastDriverLocation');
  return stored ? JSON.parse(stored) : null;
};

const storeLocation = (location) => {
  localStorage.setItem('lastDriverLocation', JSON.stringify(location));
};

const MapComponent = () => {
  const riderId = 0;
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const [showLocationAlert, setShowLocationAlert] = useState(false);
  const alertTimeoutRef = useRef(null);

  // Get parameters from URL
  const tripid = searchParams.get('tripid') || '0';
  const shareID = searchParams.get('shareID') || '0';

  // Store previous parameters to detect changes
  const previousParamsRef = useRef({ tripid, shareID });
  localStorage.setItem('tripid', tripid);

  const [center, setCenter] = useState(() => {
    const storedLocation = getStoredLocation();
    return storedLocation || { lat: 0, lng: 0 };
  });

  const [iconSize, setIconSize] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [lastUpdate, setLastUpdate] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [directions, setDirections] = useState(null);
  const [isTurning, setIsTurning] = useState(false);
  const [currentIcon, setCurrentIcon] = useState("https://i.ibb.co/nMtVwMHV/liveimage-1.png");
  const [isCompassActive, setIsCompassActive] = useState(false);
  const [mapHeading, setMapHeading] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(18);
  const [tripclose, settripclose] = useState(false);
  
  const markerRef = useRef(null);
  const mapRef = useRef(null);
  const directionsServiceRef = useRef(null);
  const animationRef = useRef(null);
  const previousPositionRef = useRef(getStoredLocation());
  const routePathRef = useRef([]);
  const currentRouteIndexRef = useRef(0);
  const bearingRef = useRef(0);
  const targetBearingRef = useRef(0);
  const currentBearingRef = useRef(0);
  const lastAnimationTimeRef = useRef(0);
  const distanceTraveledRef = useRef(0);
  const smoothBearingRef = useRef(0);
  const turnTimeoutRef = useRef(null);
  const compassRef = useRef(null);
  const compassTimeoutRef = useRef(null);
  const apiIntervalRef = useRef(null);
  const isAnimatingRef = useRef(false);
  const turnStartTimeRef = useRef(0);
  const turnDurationRef = useRef(1000);
  const socketRef = useRef(null);
  const zoomTimeoutRef = useRef(null);

  const MOVEMENT_SPEED = 30;
  const METERS_PER_KM = 1000;
  const MS_PER_HOUR = 3600000;
  const METERS_PER_MS = (MOVEMENT_SPEED * METERS_PER_KM) / MS_PER_HOUR;
  const BEARING_SMOOTHING_FACTOR = 0.1;
  const TURN_THRESHOLD = 15;

  // Check if URL parameters have changed
  useEffect(() => {
    if (previousParamsRef.current.tripid !== tripid || previousParamsRef.current.shareID !== shareID) {
      // Clear all trip-related data when parameters change
      localStorage.removeItem('lastDriverLocation');
      previousPositionRef.current = null;
      settripclose(false);
      
      // Reset center position
      setCenter({ lat: 0, lng: 0 });
      
      // Update previous params
      previousParamsRef.current = { tripid, shareID };
      
      // Reconnect WebSocket with new parameters
      if (socketRef.current) {
        socketRef.current.close();
      }
      setupWebSocket();
    }
  }, [tripid, shareID]);

  useEffect(() => {
    if (tripclose) {
      // Clear all trip-related data when trip is closed
      localStorage.removeItem('lastDriverLocation');
      // previousPositionRef.current = null;
      // setCenter({ lat: 0, lng: 0 });
      settripclose(true)
    }
  }, [tripclose]);

  useEffect(() => {
    if (center.lat === 0 && center.lng === 0) {
      setShowLocationAlert(true);
    } else  {
      setShowLocationAlert(false);
      if (alertTimeoutRef.current) {
        clearTimeout(alertTimeoutRef.current);
      }
    }
  }, [center]);

  useEffect(() => {
    getRiderDetails();
    getUserLocation();
    setupWebSocket();
    
    apiIntervalRef.current = {
      interval: null,
      isActive: false
    };
    
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }
    
    return () => {
      if (apiIntervalRef.current.interval) {
        clearInterval(apiIntervalRef.current.interval);
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (turnTimeoutRef.current) {
        clearTimeout(turnTimeoutRef.current);
      }
      if (compassTimeoutRef.current) {
        clearTimeout(compassTimeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, [riderId]);

  const setupWebSocket = () => {
    const socketUrl = `WSS://uat.zippyridechatapi.projectpulse360.com/TripShare?tripid=${tripid}&shareID=${shareID}`;
    socketRef.current = new WebSocket(socketUrl);

    socketRef.current.onopen = () => {
      console.log("WebSocket connection established");
      setStatus("connected");
    };

    socketRef.current.onmessage = (event) => {
      try {
        if (event.data !== 'heartbeat') {
          const data = JSON.parse(event.data);

          if (data.Istripclose == true) {
            settripclose(true);
            // setCenter({ lat: 0, lng: 0 });
            localStorage.removeItem('lastDriverLocation');
            return;
          }
          
          if (event.data === 'heartbeat' || event.data === 'pong') {
            console.log('❤️ Heartbeat received');
            return;
          }
          
          if (data.Latitude && data.Longtitude) {
            const lat = parseFloat(data.Latitude);
            const lng = parseFloat(data.Longtitude);
            if (lat && lng) {
              const newPosition = { lat, lng };
              handleNewPosition(newPosition);
              
              setStatus("connected");
              setLastUpdate(new Date().toLocaleTimeString());
            }
          }
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    };

    socketRef.current.onerror = (error) => {
      console.error("WebSocket error:", error);
      setStatus("disconnected");
    };

    socketRef.current.onclose = () => {
      console.log("WebSocket connection closed");
      setStatus("disconnected");
      setTimeout(setupWebSocket, 5000);
    };
  };

  const handleNewPosition = (newPosition) => {
    storeLocation(newPosition);
    
    if (apiIntervalRef.current.interval) {
      clearInterval(apiIntervalRef.current.interval);
      apiIntervalRef.current.isActive = false;
    }
    
    isAnimatingRef.current = true;
    
    if (previousPositionRef.current) {
      calculateRoute(previousPositionRef.current, newPosition);
    } else {
      setCenter(newPosition);
      if (mapRef.current) {
        mapRef.current.panTo(newPosition);
      }
    }
    
    previousPositionRef.current = newPosition;
  };

  const handleOrientation = (event) => {
    if (!isCompassActive || !mapRef.current) return;
    
    let heading = 0;
    
    if (event.alpha !== null) {
      heading = event.alpha;
      
      if (event.webkitCompassHeading !== undefined) {
        heading = event.webkitCompassHeading;
      }
      
      setMapHeading(heading);
      
      if (compassTimeoutRef.current) {
        clearTimeout(compassTimeoutRef.current);
      }
      
      compassTimeoutRef.current = setTimeout(() => {
        mapRef.current.setHeading(heading);
      }, 100);
    }
  };

  const toggleCompass = () => {
    setIsCompassActive(!isCompassActive);
    
    if (!isCompassActive) {
      if (mapRef.current) {
        mapRef.current.setHeading(0);
        setMapHeading(0);
      }
      
      if (typeof DeviceOrientationEvent !== 'undefined' && 
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
          .then(permissionState => {
            if (permissionState === 'granted') {
              window.addEventListener('deviceorientation', handleOrientation);
            }
          })
          .catch(console.error);
      }
    } else {
      if (mapRef.current) {
        mapRef.current.setHeading(0);
        mapRef.current.setTilt(0);
      }
    }
  };

  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.error("Error getting user location:", error);
        }
      );
    }
  };

  const getRiderDetails = async () => {
    try {
      const res = await axios.get(
        `https://uat.zippyrideuserapi.projectpulse360.com/api/riders/GetRiderInfo/${0}`
      );
      if (res.data && res.data.length > 0) {
        const rider = res.data[0];

        const lat = rider.latitude ? parseFloat(rider.latitude) : null;
        const lng = rider.longitude
          ? parseFloat(rider.longitude)
          : rider.longtitude
          ? parseFloat(rider.longtitude)
          : null;

        if (lat && lng) {
          const newPosition = { lat, lng };
          handleNewPosition(newPosition);
          
          setStatus("connected");
          setLastUpdate(new Date().toLocaleTimeString());
        } else {
          // Fallback to stored location if no new location is available
          const storedLocation = getStoredLocation();
          if (storedLocation) {
            setCenter(storedLocation);
            if (mapRef.current) {
              mapRef.current.panTo(storedLocation);
            }
          }
        }
      }
    } catch (error) {
      setStatus("disconnected");
      console.error("Error fetching rider details:", error);
      
      // Fallback to stored location on error
      const storedLocation = getStoredLocation();
      if (storedLocation) {
        setCenter(storedLocation);
        if (mapRef.current) {
          mapRef.current.panTo(storedLocation);
        }
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const startApiInterval = () => {
    if (!apiIntervalRef.current.isActive) {
      apiIntervalRef.current.interval = setInterval(() => {
        getRiderDetails();
      }, 10000);
      apiIntervalRef.current.isActive = true;
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setupWebSocket();
      setIsRefreshing(false);
      setLastUpdate(new Date().toLocaleTimeString());
    }, 500);
  };

  const calculateRoute = (start, end) => {
    if (!window.google || !window.google.maps) return;
    
    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new window.google.maps.DirectionsService();
    }
    
    directionsServiceRef.current.route(
      {
        origin: start,
        destination: end,
        travelMode: window.google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: false
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK) {
          const path = result.routes[0].overview_path;
          routePathRef.current = path;
          currentRouteIndexRef.current = 0;
          distanceTraveledRef.current = 0;
          lastAnimationTimeRef.current = performance.now();
          setDirections(result);
          animateAlongRoute();
        } else {
          setDirections(null);
          animateStraightLine(start, end);
        }
      }
    );
  };

  const animateAlongRoute = () => {
    if (currentRouteIndexRef.current >= routePathRef.current.length - 1) {
      isAnimatingRef.current = false;
      return;
    }
    
    const currentTime = performance.now();
    const timeDelta = currentTime - lastAnimationTimeRef.current;
    lastAnimationTimeRef.current = currentTime;
    
    const distanceToMove = timeDelta * METERS_PER_MS;
    distanceTraveledRef.current += distanceToMove;
    
    const startPos = routePathRef.current[currentRouteIndexRef.current];
    const endPos = routePathRef.current[currentRouteIndexRef.current + 1];
    
    const segmentDistance = window.google.maps.geometry.spherical.computeDistanceBetween(startPos, endPos);
    
    targetBearingRef.current = calculateBearing(
      { lat: startPos.lat(), lng: startPos.lng() },
      { lat: endPos.lat(), lng: endPos.lng() }
    );
    
    const angleDifference = ((targetBearingRef.current - smoothBearingRef.current + 540) % 360) - 180;
    
    if (Math.abs(angleDifference) > TURN_THRESHOLD) {
      if (!isTurning) {
        setIsTurning(true);
        setCurrentIcon("https://i.ibb.co/bjSQKFXj/ddddd.png");
        turnStartTimeRef.current = currentTime;
      }
      
      if (currentTime - turnStartTimeRef.current < turnDurationRef.current) {
        setCurrentIcon("https://i.ibb.co/bjSQKFXj/ddddd.png");
      } else {
        setIsTurning(false);
        setCurrentIcon("https://i.ibb.co/nMtVwMHV/liveimage-1.png");
      }
      
      if (turnTimeoutRef.current) {
        clearTimeout(turnTimeoutRef.current);
      }
      
      turnTimeoutRef.current = setTimeout(() => {
        setIsTurning(false);
        setCurrentIcon("https://i.ibb.co/nMtVwMHV/liveimage-1.png");
      }, turnDurationRef.current);
    } else {
      if (!isTurning) {
        setCurrentIcon("https://i.ibb.co/nMtVwMHV/liveimage-1.png");
      }
    }
    
    smoothBearingRef.current = (smoothBearingRef.current + angleDifference * BEARING_SMOOTHING_FACTOR + 360) % 360;
    bearingRef.current = smoothBearingRef.current;
    
    const segmentProgress = Math.min(distanceTraveledRef.current / segmentDistance, 1);
    
    const lat = startPos.lat() + (endPos.lat() - startPos.lat()) * segmentProgress;
    const lng = startPos.lng() + (endPos.lng() - startPos.lng()) * segmentProgress;
    
    const newPosition = { lat, lng };
    setCenter(newPosition);
    
    if (mapRef.current) {
      mapRef.current.panTo(newPosition);
      
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
      
      zoomTimeoutRef.current = setTimeout(() => {
        const newZoom = isTurning ? 18 : 18;
        if (Math.abs(zoomLevel - newZoom) > 0.5) {
          setZoomLevel(newZoom);
          mapRef.current.setZoom(newZoom);
        }
      }, 100);
    }
    
    if (segmentProgress >= 1) {
      distanceTraveledRef.current -= segmentDistance;
      currentRouteIndexRef.current++;
    }
    
    animationRef.current = requestAnimationFrame(animateAlongRoute);
  };

  const animateStraightLine = (startPos, endPos) => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    setIsTurning(false);
    setCurrentIcon("https://i.ibb.co/bjSQKFXj/ddddd.png");

    const start = new window.google.maps.LatLng(startPos.lat, startPos.lng);
    const end = new window.google.maps.LatLng(endPos.lat, endPos.lng);

    const totalDistance = window.google.maps.geometry.spherical.computeDistanceBetween(start, end);
    const startTime = performance.now();
    lastAnimationTimeRef.current = startTime;
    distanceTraveledRef.current = 0;

    targetBearingRef.current = calculateBearing(startPos, endPos);

    const animate = (currentTime) => {
      const timeDelta = currentTime - lastAnimationTimeRef.current;
      lastAnimationTimeRef.current = currentTime;

      const distanceToMove = timeDelta * METERS_PER_MS;
      distanceTraveledRef.current += distanceToMove;

      const progress = Math.min(distanceTraveledRef.current / totalDistance, 1);

      const angleDifference = ((targetBearingRef.current - smoothBearingRef.current + 540) % 360) - 180;
      smoothBearingRef.current = (smoothBearingRef.current + angleDifference * BEARING_SMOOTHING_FACTOR + 360) % 360;
      bearingRef.current = smoothBearingRef.current;

      const lat = startPos.lat + (endPos.lat - startPos.lat) * progress;
      const lng = startPos.lng + (endPos.lng - startPos.lng) * progress;

      const newPosition = { lat, lng };
      setCenter(newPosition);

      if (mapRef.current) {
        mapRef.current.panTo(newPosition);
        
        if (zoomTimeoutRef.current) {
          clearTimeout(zoomTimeoutRef.current);
        }
        
        zoomTimeoutRef.current = setTimeout(() => {
          const newZoom = 18;
          if (Math.abs(zoomLevel - newZoom) > 0.5) {
            setZoomLevel(newZoom);
            mapRef.current.setZoom(newZoom);
          }
        }, 100);
      }

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        previousPositionRef.current = endPos;
        isAnimatingRef.current = false;
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  };

  const calculateBearing = (start, end) => {
    const startLat = typeof start.lat === 'function' ? start.lat() : start.lat;
    const startLng = typeof start.lng === 'function' ? start.lng() : start.lng;
    const endLat = typeof end.lat === 'function' ? end.lat() : end.lat;
    const endLng = typeof end.lng === 'function' ? end.lng() : end.lng;
    
    const startLatRad = startLat * Math.PI / 180;
    const startLngRad = startLng * Math.PI / 180;
    const endLatRad = endLat * Math.PI / 180;
    const endLngRad = endLng * Math.PI / 180;

    let y = Math.sin(endLngRad - startLngRad) * Math.cos(endLatRad);
    let x = Math.cos(startLatRad) * Math.sin(endLatRad) -
            Math.sin(startLatRad) * Math.cos(endLatRad) * Math.cos(endLngRad - startLngRad);
    let bearing = Math.atan2(y, x);
    bearing = bearing * 180 / Math.PI;
    bearing = (bearing + 360) % 360;
    
    return bearing;
  };

  const onMapLoad = (map) => {
    mapRef.current = map;
    if (window.google && window.google.maps) {
      setIconSize(new window.google.maps.Size(40, 40));
      directionsServiceRef.current = new window.google.maps.DirectionsService();
      
      compassRef.current = document.createElement('div');
      compassRef.current.className = 'compass-control';
      compassRef.current.innerHTML = `
        <button class="compass-button ${isCompassActive ? 'active' : ''}">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z" fill="currentColor"/>
            <path d="M12 6L15.09 8.5L16 12L13.5 15.09L10 16L6.91 13.5L6 10L8.5 6.91L12 6ZM12 8.5L10.41 9.59L9.5 11L10.59 12.59L12 13.5L13.59 12.41L14.5 11L13.41 9.41L12 8.5Z" fill="currentColor"/>
          </svg>
        </button>
      `;
      
      compassRef.current.querySelector('button').addEventListener('click', toggleCompass);
      
      map.controls[window.google.maps.ControlPosition.RIGHT_BOTTOM].push(compassRef.current);
    }
  };

  return (
    <div className="professional-app-container">
      <style>
       {`
          .fullscreen-alert-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(255, 255, 255, 0.96);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            animation: fadeIn 0.3s ease;
          }
          
          .fullscreen-alert-content {
            text-align: center;
            max-width: 400px;
            padding: 20px;
          }
          
          .alert-icon-container {
            margin-bottom: 24px;
          }
          
          .alert-title {
            font-size: 24px;
            font-weight: 600;
            color: #111827;
            margin-bottom: 12px;
          }
          
          .alert-message {
            font-size: 16px;
            color: #6B7280;
            margin-bottom: 32px;
            line-height: 1.5;
          }
          
          .loading-indicator {
            display: flex;
            justify-content: center;
            gap: 8px;
          }
          
          .loading-dot {
            width: 12px;
            height: 12px;
            background-color: #4F46E5;
            border-radius: 50%;
            opacity: 0.5;
            animation: bounce 1.4s infinite ease-in-out;
          }
          
          .loading-dot:nth-child(1) {
            animation-delay: -0.32s;
          }
          
          .loading-dot:nth-child(2) {
            animation-delay: -0.16s;
          }
          
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          
          @keyframes bounce {
            0%, 80%, 100% { 
              transform: scale(0);
              opacity: 0.3;
            }
            40% { 
              transform: scale(1);
              opacity: 1;
            }
          }
          
          @media (max-width: 768px) {
            .fullscreen-alert-content {
              padding: 0 20px;
            }
            
            .alert-title {
              font-size: 20px;
            }
            
            .alert-message {
              font-size: 14px;
            }
          }
        `}
     
        {`
          .compass-control {
            margin: 10px;
          }
          .compass-button {
            background: white;
            border: none;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            transition: all 0.3s ease;
          }
          .compass-button:hover {
            background: #f1f1f1;
          }
          .compass-button.active {
            background: #4F46E5;
            color: white;
          }
          .compass-button svg {
            width: 24px;
            height: 24px;
          }
          .compass-button.active svg path {
            fill: white;
          }
          @media (max-width: 768px) {
            .compass-control {
              margin: 5px;
            }
            .compass-button {
              width: 36px;
              height: 36px;
            }
          }
        `}
      </style>
     {tripclose &&
  <div className="fullscreen-alert-overlay">
          <div className="fullscreen-alert-content">
            <div className="alert-icon-container">
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" fill="none" stroke="green" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="50" cy="50" r="45"></circle>
  <path d="M30 50l15 15l30-30"></path>
</svg>


            </div>
            <h3 className="alert-title">Trip Has been Completed</h3>
            <p className="alert-message">The trip has been completed by the driver</p>
            <div className="loading-indicator">
              {/* <div className="loading-dot"></div>
              <div className="loading-dot"></div>
              <div className="loading-dot"></div> */}
            </div>
          </div>
        </div>

     }
     {showLocationAlert && (
        <div className="fullscreen-alert-overlay">
          <div className="fullscreen-alert-content">
            <div className="alert-icon-container">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z" fill="#4F46E5"/>
                <path d="M11 7H13V13H11V7ZM11 15H13V17H11V15Z" fill="#4F46E5"/>
              </svg>
            </div>
            <h3 className="alert-title">Waiting for Location Updates</h3>
            <p className="alert-message">We're establishing connection with the driver's device</p>
            <div className="loading-indicator">
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
            </div>
          </div>
        </div>
      )}

      <header className="professional-header">
        <div className="header-content">
          <div className="logo-container">
            <div className="logo">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z" fill="#4F46E5"/>
                <path d="M12 6C8.69 6 6 8.69 6 12C6 15.31 8.69 18 12 18C15.31 18 18 15.31 18 12C18 8.69 15.31 6 12 6ZM12 16C9.79 16 8 14.21 8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12C16 14.21 14.21 16 12 16Z" fill="#4F46E5"/>
              </svg>
              <span>Zippy Ride</span>
            </div>
            <div className="logo-subtitle">Live Ride Tracking</div>
          </div>
          <div className="header-actions">
            <div className="status-container">
              <div className="status-indicator">
                <div className={`status-dot ${status}`}>
                  {status === "connected" && (
                    <div className="ripple-animation"></div>
                  )}
                </div>
                <span className="status-text">
                  {status === "connected" ? "Live Tracking Active" : 
                   status === "connecting" ? "Establishing Connection..." : 
                   "Connection Lost"}
                </span>
              </div>
              {lastUpdate && (
                <div className="last-update">
                  <span className="update-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z" fill="#6B7280"/>
                      <path d="M13 7H11V13L16.2 16.2L17 14.9L13 12.2V7Z" fill="#6B7280"/>
                    </svg>
                  </span>
                  Last update: {lastUpdate}
                </div>
              )}
            </div>
            <button 
              className={`refresh-button ${isRefreshing ? 'refreshing' : ''}`} 
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <svg 
                width="20" 
                height="20" 
                viewBox="0 0 24 24" 
                fill="none" 
                className={isRefreshing ? 'spin-animation' : ''}
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20C15.73 20 18.84 17.45 19.73 14H17.65C16.83 16.33 14.61 18 12 18C8.69 18 6 15.31 6 12C6 8.69 8.69 6 12 6C13.66 6 15.14 6.69 16.22 7.78L13 11H20V4L17.65 6.35Z" fill="currentColor"/>
              </svg>
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <div className="map-container">
        <LoadScript googleMapsApiKey="AIzaSyDyIPNKYpe9zG_JlEEhl070cC28N0q4qbc" libraries={["places", "geometry"]}>
          <GoogleMap
            mapContainerStyle={containerStyle}
            center={center}
            zoom={zoomLevel}
            options={{
              disableDefaultUI: true,
              zoomControl: true,
              gestureHandling: isCompassActive ? 'none' : 'auto',
              keyboardShortcuts: !isCompassActive,
              tilt: isCompassActive ? 45 : 0,
              styles: [
                {
                  featureType: "poi",
                  elementType: "labels",
                  stylers: [{ visibility: "off" }]
                },
                {
                  featureType: "transit",
                  elementType: "labels",
                  stylers: [{ visibility: "off" }]
                },
                {
                  featureType: "landscape",
                  elementType: "geometry",
                  stylers: [{ color: "#f5f5f5" }]
                },
                {
                  featureType: "road",
                  elementType: "geometry",
                  stylers: [{ color: "#ffffff" }]
                },
                {
                  featureType: "water",
                  elementType: "geometry",
                  stylers: [{ color: "#e9e9e9" }]
                }
              ]
            }}
            onLoad={onMapLoad}
          >
            {iconSize && (
              <Marker
                position={center}
                icon={{
                  url: currentIcon,
                  scaledSize: iconSize,
                  rotation: bearingRef.current,
                  anchor: new window.google.maps.Point(20, 20)
                }}
              />
            )}
          </GoogleMap>
        </LoadScript>
      </div>
    </div>
  );
};

export default MapComponent;