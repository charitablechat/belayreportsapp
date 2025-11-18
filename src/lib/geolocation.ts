export interface Location {
  latitude: number;
  longitude: number;
}

export interface LocationWithAddress extends Location {
  address: string;
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
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RopeWorksInspection/1.0'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to reverse geocode location');
    }

    const data = await response.json();
    
    // Extract the most relevant location name
    const address = data.address;
    const locationParts = [];
    
    if (address.town) locationParts.push(address.town);
    else if (address.city) locationParts.push(address.city);
    else if (address.village) locationParts.push(address.village);
    else if (address.hamlet) locationParts.push(address.hamlet);
    
    if (address.state) locationParts.push(address.state);
    
    return locationParts.length > 0 ? locationParts.join(', ') : data.display_name;
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    throw new Error('Failed to get location name');
  }
}

export async function getCurrentLocationWithAddress(): Promise<LocationWithAddress> {
  const location = await getCurrentLocation();
  const address = await reverseGeocode(location.latitude, location.longitude);
  
  return {
    ...location,
    address
  };
}
