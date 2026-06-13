export interface Location {
  latitude: number;
  longitude: number;
}

export interface LocationWithAddress extends Location {
  address: string;
}

export function getGeolocationErrorMessage(error: GeolocationPositionError): string {
  switch (error.code) {
    case 1: // PERMISSION_DENIED
      return "Location access was denied. Please enable location permissions in your browser/device settings.";
    case 2: // POSITION_UNAVAILABLE
      return "Unable to determine your location. Please ensure GPS is enabled.";
    case 3: // TIMEOUT
      return "Location request timed out. Please try again or check your GPS signal.";
    default:
      return "Failed to get location. Please try again.";
  }
}

export async function getCurrentLocation(): Promise<Location> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation is not supported by this browser"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  });
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  // Validate input ranges to prevent injection and API abuse
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('Invalid latitude: must be between -90 and 90');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Invalid longitude: must be between -180 and 180');
  }

  try {
    // Use URL constructor with searchParams for safe encoding
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'json');
    url.searchParams.set('lat', latitude.toString());
    url.searchParams.set('lon', longitude.toString());
    url.searchParams.set('zoom', '16');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BelayReportsInspection/1.0'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to reverse geocode location');
    }

    const data = await response.json();
    
    // Extract the most relevant location name
    const address = data.address;
    const locationParts = [];
    
    // Prioritize city/town with better fallback order
    if (address.city) locationParts.push(address.city);
    else if (address.town) locationParts.push(address.town);
    else if (address.municipality) locationParts.push(address.municipality);
    else if (address.village) locationParts.push(address.village);
    else if (address.hamlet) locationParts.push(address.hamlet);
    else if (address.county) locationParts.push(address.county);
    
    if (address.state) locationParts.push(address.state);
    
    return locationParts.length > 0 ? locationParts.join(', ') : data.display_name;
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    throw new Error('Failed to get location name');
  }
}

export async function getCurrentLocationWithAddress(): Promise<LocationWithAddress> {
  const location = await getCurrentLocation();
  
  try {
    const address = await reverseGeocode(location.latitude, location.longitude);
    return { ...location, address };
  } catch (error) {
    // Return coordinates with fallback address if reverse geocoding fails
    console.warn('Reverse geocoding failed, using coordinates as fallback');
    return {
      ...location,
      address: `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
    };
  }
}
