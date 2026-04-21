// Travel Planner App
// Backend: Cloudflare Workers + KV with authentication

const API_URL = 'https://travel-planner-api.vmurthy.workers.dev';

let currentUser = null;
let authToken = null;
let currentTrip = null;
let trips = [];

// Load auth token from localStorage
function loadAuthToken() {
  const stored = localStorage.getItem('travel_planner_auth');
  if (stored) {
    try {
      const data = JSON.parse(stored);
      authToken = data.token;
      currentUser = { id: data.userId, email: data.email };
      return true;
    } catch (e) {
      localStorage.removeItem('travel_planner_auth');
    }
  }
  return false;
}

// Save auth token to localStorage
function saveAuthToken(accessToken, userId, email, refreshToken) {
  authToken = accessToken;
  currentUser = { id: userId, email };
  const authData = { token: accessToken, userId, email };
  if (refreshToken) {
    authData.refreshToken = refreshToken;
  }
  localStorage.setItem('travel_planner_auth', JSON.stringify(authData));
}

// Clear auth
function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('travel_planner_auth');
  location.reload();
}

// ==================== DRAG AND DROP ====================

let draggedEvent = null;

function handleDragStart(e, dayIndex, eventIndex) {
  draggedEvent = { dayIndex, eventIndex };
  e.target.style.opacity = '0.4';
}

function handleDragEnd(e) {
  e.target.style.opacity = '1';
}

function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('bg-blue-50', 'border-blue-300');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('bg-blue-50', 'border-blue-300');
}

async function handleDrop(e, targetDayIndex) {
  e.preventDefault();
  e.currentTarget.classList.remove('bg-blue-50', 'border-blue-300');
  
  if (!draggedEvent) return;
  
  const { dayIndex: sourceDayIndex, eventIndex } = draggedEvent;
  
  // Don't do anything if dropped on the same day
  if (sourceDayIndex === targetDayIndex) {
    draggedEvent = null;
    return;
  }
  
  // Get the event being moved
  const updatedDays = [...currentTrip.days];
  const eventToMove = updatedDays[sourceDayIndex].events[eventIndex];
  
  // Remove from source day
  updatedDays[sourceDayIndex].events = updatedDays[sourceDayIndex].events.filter((_, i) => i !== eventIndex);
  
  // Add to target day
  updatedDays[targetDayIndex].events = [...(updatedDays[targetDayIndex].events || []), eventToMove];
  
  // Sort events by time in target day
  updatedDays[targetDayIndex].events = sortEventsByTime(updatedDays[targetDayIndex].events);
  
  // Update trip
  await updateTrip({ days: updatedDays });
  draggedEvent = null;
  render();
}

// ==================== URL ROUTING ====================

function getTripSlugFromUrl() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#/')) {
    return decodeURIComponent(hash.slice(2));
  }
  return null;
}

function setTripUrl(slug) {
  if (slug) {
    window.location.hash = `/${encodeURIComponent(slug)}`;
  } else {
    window.location.hash = '';
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ==================== API FUNCTIONS ====================

async function apiCall(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers
  });
  
  if (response.status === 401) {
    // Token expired or invalid
    logout();
    throw new Error('Authentication required');
  }
  
  return response;
}

async function loadTrips() {
  try {
    const response = await apiCall('/api/trips');
    const data = await response.json();
    trips = data.trips || [];
  } catch (error) {
    console.error('Error loading trips:', error);
    trips = [];
  }
}

async function createTrip(tripData) {
  const response = await apiCall('/api/trips', {
    method: 'POST',
    body: JSON.stringify(tripData)
  });
  const data = await response.json();
  if (data.success) {
    trips.push(data.trip);
    currentTrip = data.trip;
    return data.trip;
  }
  throw new Error(data.error || 'Failed to create trip');
}

async function updateTrip(updates, tripId = null) {
  const id = tripId || currentTrip?.id;
  if (!id) return;
  
  const response = await apiCall(`/api/trips/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates)
  });
  
  const data = await response.json();
  if (data.success) {
    // Update the trip in the trips array
    const index = trips.findIndex(t => t.id === id);
    if (index !== -1) trips[index] = data.trip;
    
    // Update currentTrip if it's the one being edited
    if (currentTrip?.id === id) {
      currentTrip = data.trip;
    }
  }
  return data;
}

async function deleteTrip(tripId) {
  const response = await apiCall(`/api/trips/${tripId}`, {
    method: 'DELETE'
  });
  
  const data = await response.json();
  if (data.success) {
    trips = trips.filter(t => t.id !== tripId);
    if (currentTrip?.id === tripId) {
      currentTrip = trips[0] || null;
    }
  }
  return data;
}

function selectTrip(tripId) {
  currentTrip = trips.find(t => t.id === tripId) || null;
  if (currentTrip) {
    const slug = slugify(currentTrip.title || 'untitled-trip');
    setTripUrl(slug);
    
    // Auto-update day labels if they still use old "Day X" format
    const updatedDays = recalculateDayLabels(currentTrip.days, currentTrip.dates);
    if (updatedDays && JSON.stringify(updatedDays) !== JSON.stringify(currentTrip.days)) {
      // Silently update the trip with new day labels
      updateTrip({ days: updatedDays }).then(() => {
        render();
      });
      return; // render will be called after update
    }
  }
  render();
}

function goHome() {
  currentTrip = null;
  setTripUrl('');
  renderTripList();
}

function findTripBySlug(slug) {
  return trips.find(t => slugify(t.title || 'untitled-trip') === slug);
}

// ==================== UI RENDER FUNCTIONS ====================

function renderTripList() {
  const app = document.getElementById('app');
  
  app.innerHTML = `
    <div class="min-h-screen bg-slate-50">
      <!-- Header -->
      <header class="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-6 px-4">
        <div class="max-w-4xl mx-auto flex justify-between items-center">
          <div>
            <h1 class="text-2xl font-bold">✈️ Travel Planner</h1>
            <p class="text-white/80 text-sm">${currentUser?.email || 'Guest'}</p>
          </div>
          <button onclick="logout()" class="text-white/80 hover:text-white text-sm flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            Logout
          </button>
        </div>
      </header>
      
      <div class="max-w-4xl mx-auto p-4">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-xl font-semibold text-gray-800">Trips</h2>
          <button onclick="showCreateTripModal()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            New Trip
          </button>
        </div>
        
        <div class="grid gap-4">
          ${trips.length === 0 ? `
            <div class="text-center py-12 text-gray-500">
              <p class="text-lg mb-2">No trips yet</p>
              <p class="text-sm">Create your first trip to get started</p>
            </div>
          ` : trips.map(trip => `
            <div class="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition cursor-pointer" onclick="selectTrip('${trip.id}')">
              <div class="flex justify-between items-start">
                <div>
                  <div class="flex items-center gap-2">
                    <h3 class="text-lg font-semibold text-gray-800">${trip.title || 'Untitled Trip'}</h3>
                  </div>
                  <p class="text-gray-600 mt-1">${formatDateRange(trip.startDate, trip.endDate)}</p>
                  ${trip.destinations?.length ? `
                    <div class="flex gap-2 mt-2">
                      ${trip.destinations.map(d => `<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">${d}</span>`).join('')}
                    </div>
                  ` : ''}
                </div>
                <div class="flex gap-2">
                  <button onclick="event.stopPropagation(); showEditTripModal('${trip.id}')" class="text-blue-500 hover:text-blue-700 p-2" title="Edit trip">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  </button>
                  <button onclick="event.stopPropagation(); confirmDeleteTrip('${trip.id}')" class="text-red-500 hover:text-red-700 p-2" title="Delete trip">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function showCreateTripModal() {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-md">
      <h3 class="text-xl font-semibold mb-4">Create New Trip</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Trip Name</label>
          <input type="text" id="new-trip-title" class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., Japan Adventure 2026">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input type="date" id="new-trip-start-date" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input type="date" id="new-trip-end-date" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Destinations (comma-separated)</label>
          <input type="text" id="new-trip-destinations" class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., Tokyo, Kyoto, Osaka">
        </div>
        <div class="flex gap-3 pt-4">
          <button onclick="this.closest('.fixed').remove()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 transition">Cancel</button>
          <button onclick="handleCreateTrip()" class="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition">Create</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleCreateTrip() {
  const title = document.getElementById('new-trip-title').value;
  const startDate = document.getElementById('new-trip-start-date').value;
  const endDate = document.getElementById('new-trip-end-date').value;
  const destinationsInput = document.getElementById('new-trip-destinations').value;
  
  if (!title) {
    alert('Please enter a trip name');
    return;
  }
  
  if (!startDate || !endDate) {
    alert('Please select start and end dates');
    return;
  }
  
  if (new Date(startDate) > new Date(endDate)) {
    alert('End date must be after start date');
    return;
  }
  
  const destinations = destinationsInput.split(',').map(d => d.trim()).filter(d => d);
  
  try {
    await createTrip({ 
      title, 
      startDate, 
      endDate,
      destinations 
    });
    document.querySelector('.fixed').remove();
    render();
  } catch (error) {
    alert(error.message);
  }
}

function confirmDeleteTrip(tripId) {
  const trip = trips.find(t => t.id === tripId);
  const tripName = trip?.title || 'this trip';
  
  if (confirm(`Are you sure you want to delete "${tripName}"? This action cannot be undone.`)) {
    deleteTrip(tripId).then(() => renderTripList());
  }
}

function showEditTripModal(tripId) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-md">
      <h3 class="text-xl font-semibold mb-4">Edit Trip</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Trip Name</label>
          <input type="text" id="edit-trip-title" value="${trip.title || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., Japan Adventure 2026">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
          <input type="date" id="edit-trip-start-date" value="${trip.startDate || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">End Date</label>
          <input type="date" id="edit-trip-end-date" value="${trip.endDate || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Destination(s)</label>
          <input type="text" id="edit-trip-destination" value="${trip.destination || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., London, UK">
        </div>
        <div class="flex gap-3 pt-4">
          <button onclick="this.closest('.fixed').remove()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 transition">Cancel</button>
          <button onclick="handleEditTrip('${tripId}')" class="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition">Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('edit-trip-title').focus();
}

async function handleEditTrip(tripId) {
  const title = document.getElementById('edit-trip-title').value.trim();
  const startDate = document.getElementById('edit-trip-start-date').value;
  const endDate = document.getElementById('edit-trip-end-date').value;
  const destination = document.getElementById('edit-trip-destination').value.trim();
  
  if (!title) {
    alert('Please enter a trip name');
    return;
  }
  
  try {
    await updateTrip({ title, startDate, endDate, destination }, tripId);
    await loadTrips();
    
    // Update currentTrip if it's the one being edited
    if (currentTrip && currentTrip.id === tripId) {
      currentTrip = trips.find(t => t.id === tripId);
      render();
    } else {
      renderTripList();
    }
    
    document.querySelector('.fixed').remove();
  } catch (error) {
    alert(error.message);
  }
}

// ==================== MAIN RENDER ====================

function render() {
  if (!currentTrip) {
    renderTripList();
    return;
  }
  
  renderTripEditor();
}

function renderTripEditor() {
  const app = document.getElementById('app');
  const trip = currentTrip;
  
  // Calculate stats - use stored stats if available, otherwise calculate
  const totalDays = trip.stats?.totalDays ?? (trip.days?.length || 0);
  const cityCount = trip.stats?.cityCount ?? [...new Set((trip.days || []).map(d => d.location).filter(Boolean))].length;
  const city1Days = trip.stats?.city1Days ?? (trip.days || []).filter(d => d.location?.toLowerCase().includes('london')).length;
  const city2Days = trip.stats?.city2Days ?? (trip.days || []).filter(d => d.location?.toLowerCase().includes('edinburgh')).length;
  const city1Name = trip.stats?.city1Name || 'London';
  const city2Name = trip.stats?.city2Name || 'Edinburgh';
  
  // Determine header gradient based on destinations
  const hasUK = (trip.destinations || []).some(d => d.toLowerCase().includes('london') || d.toLowerCase().includes('edinburgh') || d.toLowerCase().includes('uk'));
  const headerGradient = hasUK 
    ? 'bg-gradient-to-r from-red-600 to-blue-600'
    : 'bg-gradient-to-r from-blue-600 to-purple-600';
  
  app.innerHTML = `
    <div class="min-h-screen bg-slate-50">
      <!-- Header -->
      <header class="${headerGradient} text-white py-6 px-4">
        <div class="max-w-4xl mx-auto">
          <div class="flex justify-between items-start mb-4">
            <button onclick="goHome()" class="text-white/80 hover:text-white flex items-center gap-1 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              Back to Trips
            </button>
            <div class="flex gap-2">
              ${trip.role === 'owner' ? `
                <button onclick="createTravelGuide()" class="text-white/80 hover:text-white flex items-center gap-2 text-sm bg-white/10 px-3 py-2 rounded-lg hover:bg-white/20 transition">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                  Create Travel Guide
                </button>
                <button onclick="showCollaboratorsModal()" class="text-white/80 hover:text-white flex items-center gap-2 text-sm bg-white/10 px-3 py-2 rounded-lg hover:bg-white/20 transition">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                  Share Trip
                  ${(trip.collaborators?.length || 0) > 0 ? `<span class="bg-white/30 px-2 py-0.5 rounded-full text-xs">${trip.collaborators.length}</span>` : ''}
                </button>
              ` : `
                <div class="text-white/80 text-sm bg-white/10 px-3 py-2 rounded-lg flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                  Shared with you
                </div>
              `}
            </div>
          </div>
          <h1 class="text-3xl font-bold mb-2">${hasUK ? '🇬🇧' : '✈️'} ${trip.title || 'Untitled Trip'}</h1>
          <p class="text-white/90 text-lg">${formatDateRange(trip.startDate, trip.endDate)}</p>
          <div class="flex gap-2 mt-3">
            ${(trip.destinations || []).map(d => `
              <span class="px-3 py-1 bg-white/20 rounded-full text-sm">${d}</span>
            `).join('')}
          </div>
        </div>
      </header>

      <main class="max-w-4xl mx-auto px-4 py-8">
        <!-- Quick Stats -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <button onclick="showEditStatsModal()" class="bg-white rounded-xl p-4 shadow-sm border border-slate-200 text-left hover:border-blue-400 transition-colors">
            <div class="text-2xl font-bold text-slate-800">${totalDays}</div>
            <div class="text-sm text-slate-500">Days</div>
          </button>
          <button onclick="showEditStatsModal()" class="bg-white rounded-xl p-4 shadow-sm border border-slate-200 text-left hover:border-blue-400 transition-colors">
            <div class="text-2xl font-bold text-slate-800">${cityCount}</div>
            <div class="text-sm text-slate-500">Cities</div>
          </button>
          <button onclick="showEditStatsModal()" class="bg-white rounded-xl p-4 shadow-sm border border-slate-200 text-left hover:border-blue-400 transition-colors">
            <div class="text-2xl font-bold text-red-600">${city1Days}</div>
            <div class="text-sm text-slate-500">Days in ${city1Name}</div>
          </button>
          <button onclick="showEditStatsModal()" class="bg-white rounded-xl p-4 shadow-sm border border-slate-200 text-left hover:border-blue-400 transition-colors">
            <div class="text-2xl font-bold text-blue-600">${city2Days}</div>
            <div class="text-sm text-slate-500">Days in ${city2Name}</div>
          </button>
        </div>

        <!-- Travel -->
        <section class="mb-8">
          <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20"></path><path d="M13 2v20"></path><path d="M22 2l-9 10 9 10"></path></svg>
            Travel
          </h2>
          <div class="grid md:grid-cols-2 gap-4">
            ${(trip.travel || []).map((travel, i) => `
              <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
                <div class="flex justify-between items-start mb-2">
                  <h3 class="font-semibold text-slate-800">${travel.direction || travel.type}</h3>
                  <div class="flex gap-2">
                    <button onclick="editTravel(${i})" class="text-slate-400 hover:text-blue-600" title="Edit">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button onclick="deleteTravel(${i})" class="text-slate-400 hover:text-red-600" title="Delete">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </div>
                </div>
                <p class="text-sm text-slate-600">${travel.date || 'TBD'} ${travel.route || ''}</p>
                <p class="text-sm text-slate-500 mb-3">${travel.details || ''}</p>
                <div class="flex gap-2">
                  ${travel.link 
                    ? `<a href="${travel.link}" target="_blank" class="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">View Confirmation</a>`
                    : ''
                  }
                  <button onclick="editTravelLink(${i})" class="text-xs px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50">
                    ${travel.link ? 'Update' : 'Add'} Link
                  </button>
                </div>
              </div>
            `).join('') || `
              <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200 border-dashed text-center text-slate-400">
                No travel added yet
              </div>
            `}
          </div>
          <button onclick="showAddTravelModal()" class="mt-4 text-blue-600 hover:text-blue-700 flex items-center gap-1 text-sm font-medium">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Add Travel
          </button>
        </section>

        <!-- Accommodations -->
        <section class="mb-8">
          <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            Accommodations
          </h2>
          <div class="grid md:grid-cols-2 gap-4">
            ${(trip.accommodations || []).map((acc, i) => `
              <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200 ${!acc.confirmed ? 'border-dashed border-amber-300 bg-amber-50/50' : ''}">
                <div class="flex justify-between items-start mb-2">
                  <h3 class="font-semibold text-slate-800">${acc.name}</h3>
                  <div class="flex gap-2">
                    <button onclick="editAccommodation(${i})" class="text-slate-400 hover:text-blue-600" title="Edit">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button onclick="deleteAccommodation(${i})" class="text-slate-400 hover:text-red-600" title="Delete">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </div>
                </div>
                <p class="text-sm text-slate-600 mb-1">📍 ${acc.location}</p>
                <p class="text-sm text-slate-500 mb-3">${acc.dates}</p>
                <div class="flex gap-2">
                  ${acc.link 
                    ? `<a href="${acc.link}" target="_blank" class="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">View Confirmation</a>`
                    : ''
                  }
                  <button onclick="updateAccommodationLink(${i})" class="text-xs px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50">
                    ${acc.link ? 'Update' : 'Add'} Link
                  </button>
                </div>
              </div>
            `).join('') || `
              <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200 border-dashed text-center text-slate-400">
                No accommodations added yet
              </div>
            `}
          </div>
          <button onclick="showAddAccommodationModal()" class="mt-4 text-blue-600 hover:text-blue-700 flex items-center gap-1 text-sm font-medium">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Add Accommodation
          </button>
        </section>

        <!-- Day by Day Itinerary -->
        <section class="mb-8">
          <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Day by Day
          </h2>
          <div class="space-y-3">
            ${(trip.days || []).map((day, dayIndex) => `
              <div class="day-card bg-white rounded-xl p-5 shadow-sm border border-slate-200 transition-all duration-200" 
                   ondrop="handleDrop(event, ${dayIndex})" 
                   ondragover="handleDragOver(event)" 
                   ondragleave="handleDragLeave(event)">
                <div class="flex items-center gap-4 mb-3">
                  <div class="w-14 h-14 rounded-lg ${getLocationColor(day.location)} text-white flex flex-col items-center justify-center text-center">
                    <span class="text-xs font-medium">${formatDateShort(day.date).split(' ')[0]}</span>
                    <span class="text-lg font-bold">${formatDateShort(day.date).split(' ')[1]}</span>
                  </div>
                  <div class="flex-1">
                    <h3 class="font-semibold text-slate-800">${day.dayOfWeek || 'Day'} — ${day.label || `Day ${dayIndex + 1}`}</h3>
                    <p class="text-sm text-slate-500 cursor-pointer hover:text-slate-700" onclick="editDayLocation(${dayIndex})" title="Click to edit location">📍 ${day.location || 'Location TBD'}</p>
                  </div>
                  <button onclick="showAddEventModal(${dayIndex})" class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Add activity">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                  </button>
                  <button onclick="if(confirm('Delete this entire day?')) deleteDay(${dayIndex})" class="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Delete day">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
                
                ${(day.events || []).length > 0 ? `
                  <div class="ml-[4.5rem] space-y-2">
                    ${(day.events || []).map((event, eventIndex) => `
                      <div class="group flex flex-col gap-2 p-3 rounded-lg border ${getTypeColor(event.type)} cursor-move" 
                           draggable="true" 
                           ondragstart="handleDragStart(event, ${dayIndex}, ${eventIndex})" 
                           ondragend="handleDragEnd(event)">
                        <div class="flex items-center gap-3">
                          <span class="text-xs font-medium w-16">${event.time || 'TBD'}</span>
                          <div class="flex-1">
                            <div class="flex items-center gap-2">
                              <span class="font-medium">${event.title}</span>
                              ${event.rating ? `
                                <div class="flex text-yellow-400 text-sm">
                                  ${'★'.repeat(event.rating)}${'☆'.repeat(5 - event.rating)}
                                </div>
                              ` : ''}
                            </div>
                            ${event.location ? `<span class="text-xs text-slate-500">📍 ${event.location}</span>` : ''}
                            ${event.link ? `<a href="${event.link}" target="_blank" class="ml-2 text-xs text-blue-600 hover:underline">🔗 link</a>` : ''}
                          </div>
                          <button onclick="editEvent(${dayIndex}, ${eventIndex})" class="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded" title="Edit">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                          </button>
                          <button onclick="deleteEvent(${dayIndex}, ${eventIndex})" class="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 rounded" title="Delete">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                          </button>
                        </div>
                        ${event.notes ? `
                          <div class="ml-[4.5rem] text-xs text-slate-600 italic bg-slate-50 p-2 rounded">
                            💭 ${event.notes}
                          </div>
                        ` : ''}
                      </div>
                    `).join('')}
                  </div>
                ` : `
                  <button onclick="showAddEventModal(${dayIndex})" class="ml-[4.5rem] w-[calc(100%-4.5rem)] p-3 rounded-lg border border-dashed border-slate-300 text-slate-400 text-sm hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50 transition-colors">
                    + Add activity
                  </button>
                `}
              </div>
            `).join('') || `
              <div class="bg-white rounded-xl p-8 shadow-sm border border-slate-200 border-dashed text-center text-slate-400">
                No days added yet. Click "Add Day" to start planning.
              </div>
            `}
          </div>
          <button onclick="addDay()" class="mt-4 w-full p-3 border border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50 transition-colors">
            + Add Day
          </button>
        </section>

        <!-- Packing List -->
        <section class="mb-8">
          <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            Packing List
            <span class="text-sm font-normal text-slate-400">(${trip.packingList?.filter(i => i.packed).length || 0}/${trip.packingList?.length || 0} packed)</span>
          </h2>
          <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
            <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
              ${(trip.packingList || []).map((item, i) => `
                <div class="group flex items-center gap-2 p-2 rounded hover:bg-slate-50">
                  <input type="checkbox" ${item.packed ? 'checked' : ''} 
                    onchange="togglePacked(${i})"
                    class="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer">
                  <span class="flex-1 ${item.packed ? 'line-through text-slate-400' : 'text-slate-700'}">${item.item}</span>
                  <button onclick="deletePackingItem(${i})" class="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 rounded" title="Remove">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              `).join('') || '<div class="col-span-full text-center text-slate-400 py-4">No items yet</div>'}
            </div>
            <button onclick="addPackingItem()" class="w-full p-2 border border-dashed border-slate-300 rounded-lg text-slate-500 text-sm hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50 transition-colors">
              + Add item
            </button>
          </div>
        </section>

        <!-- Notes -->
        <section class="mb-8">
          <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            Notes
          </h2>
          <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
            <ul class="space-y-2 mb-4">
              ${(trip.notes || []).map((note, i) => `
                <li class="group flex items-start gap-2 text-slate-600">
                  <span class="text-slate-400">•</span>
                  <span class="flex-1">${note}</span>
                  <button onclick="deleteNote(${i})" class="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 rounded" title="Delete">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </li>
              `).join('') || '<li class="text-slate-400 text-center py-4">No notes yet</li>'}
            </ul>
            <button onclick="addNote()" class="w-full p-2 border border-dashed border-slate-300 rounded-lg text-slate-500 text-sm hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50 transition-colors">
              + Add note
            </button>
          </div>
        </section>

        <!-- Trip Memories -->
        <section class="mb-8">
          <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            Trip Memories
          </h2>
          
          <!-- Photo Gallery -->
          <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200 mb-4">
            <h3 class="font-semibold text-slate-700 mb-3">Photos</h3>
            ${(trip.memories?.photos?.length > 0) ? `
              <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                ${trip.memories.photos.map(photo => `
                  <div class="group relative aspect-square rounded-lg overflow-hidden bg-slate-100 cursor-pointer" onclick="showPhotoLightbox('${photo.id}')">
                    <img src="${API_URL}/api/photos/${photo.key}" alt="${photo.caption || 'Trip photo'}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200">
                    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <button onclick="event.stopPropagation(); deletePhoto('${photo.id}')" class="opacity-0 group-hover:opacity-100 p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-opacity">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                    </div>
                    ${photo.caption ? `<div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2"><p class="text-white text-xs">${photo.caption}</p></div>` : ''}
                  </div>
                `).join('')}
              </div>
            ` : `
              <p class="text-slate-400 text-center py-8">No photos yet. Upload your trip memories!</p>
            `}
            <button onclick="showUploadPhotoModal()" class="w-full p-3 border border-dashed border-slate-300 rounded-lg text-slate-500 text-sm hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50 transition-colors">
              + Upload Photo
            </button>
          </div>
          
          <!-- Trip Highlights -->
          <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
            <h3 class="font-semibold text-slate-700 mb-3">Trip Highlights & Notes</h3>
            <textarea 
              id="trip-highlights" 
              rows="6" 
              class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              placeholder="Share your favorite moments, best meals, recommendations, or any other highlights from your trip..."
              onblur="saveHighlights()"
            >${trip.memories?.highlights || ''}</textarea>
            <p class="text-xs text-slate-400 mt-2">Your highlights are saved automatically</p>
          </div>
        </section>
      </main>

      <!-- Footer -->
      <footer class="text-center py-6 text-slate-400 text-sm">
        Last updated: ${new Date().toLocaleDateString()}
      </footer>
    </div>
  `;
}

// Helper to format date range from startDate and endDate
function formatDateRange(startDate, endDate) {
  if (!startDate && !endDate) return 'Dates TBD';
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  if (startDate && !endDate) {
    const start = new Date(startDate);
    return `${months[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()}`;
  }
  
  if (!startDate && endDate) {
    const end = new Date(endDate);
    return `${months[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Same year
  if (start.getFullYear() === end.getFullYear()) {
    // Same month
    if (start.getMonth() === end.getMonth()) {
      return `${months[start.getMonth()]} ${start.getDate()}-${end.getDate()}, ${start.getFullYear()}`;
    }
    // Different months
    return `${months[start.getMonth()]} ${start.getDate()} - ${months[end.getMonth()]} ${end.getDate()}, ${start.getFullYear()}`;
  }
  
  // Different years
  return `${months[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} - ${months[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

// Helper to parse trip start date from dates string like "March 30 - April 8, 2026"
function parseTripStartDate(datesString) {
  if (!datesString) return null;
  
  // Try to extract first date from range like "March 30 - April 8, 2026" or "Mar 30 - Apr 8"
  const match = datesString.match(/^([A-Za-z]+)\s+(\d+)[\s,-]/);
  if (!match) return null;
  
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthStr = match[1].toLowerCase().substring(0, 3);
  const day = parseInt(match[2], 10);
  const monthIndex = monthNames.indexOf(monthStr);
  
  if (monthIndex === -1) return null;
  
  // Try to extract year from the dates string
  const yearMatch = datesString.match(/(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
  
  return new Date(year, monthIndex, day);
}

function formatDateLabel(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  return {
    label: `${months[date.getMonth()]} ${date.getDate()}`,
    dayOfWeek: days[date.getDay()],
    fullDate: `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
  };
}

// Helper to recalculate all day labels based on trip start date
function recalculateDayLabels(days, tripDates) {
  const startDate = parseTripStartDate(tripDates);
  if (!startDate || !days || days.length === 0) return days;
  
  return days.map((day, index) => {
    const dayDate = new Date(startDate);
    dayDate.setDate(startDate.getDate() + index);
    const dateInfo = formatDateLabel(dayDate);
    
    return {
      ...day,
      date: dateInfo.fullDate,
      dayOfWeek: dateInfo.dayOfWeek,
      label: dateInfo.label
    };
  });
}

// Helper to sort events by time (events without time go to bottom)
function sortEventsByTime(events) {
  if (!events || events.length === 0) return events;
  
  return [...events].sort((a, b) => {
    // If neither has time, maintain order
    if (!a.time && !b.time) return 0;
    // If only a has no time, it goes after b
    if (!a.time) return 1;
    // If only b has no time, it goes after a
    if (!b.time) return -1;
    
    // Both have times, parse and compare
    const timeA = parseTimeToMinutes(a.time);
    const timeB = parseTimeToMinutes(b.time);
    
    return timeA - timeB;
  });
}

// Helper to convert time string like "10:30 AM" to minutes since midnight
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return Infinity; // No time goes to end
  
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return Infinity;
  
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  
  // Convert to 24-hour format
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  
  return hour * 60 + minute;
}

// ==================== ADD/EDIT FUNCTIONS ====================

async function addDay() {
  const days = currentTrip.days || [];
  const dayIndex = days.length;
  
  // Calculate date based on trip start date
  let startDate = null;
  
  // Try to get start date from startDate field (YYYY-MM-DD format)
  if (currentTrip.startDate) {
    startDate = new Date(currentTrip.startDate);
  } 
  // Fallback to parsing dates field if it exists
  else if (currentTrip.dates) {
    startDate = parseTripStartDate(currentTrip.dates);
  }
  
  let dateInfo = { label: `Day ${dayIndex + 1}`, dayOfWeek: '', fullDate: '' };
  
  if (startDate) {
    const dayDate = new Date(startDate);
    dayDate.setDate(startDate.getDate() + dayIndex);
    dateInfo = formatDateLabel(dayDate);
  }
  
  const newDay = {
    date: dateInfo.fullDate,
    dayOfWeek: dateInfo.dayOfWeek,
    label: dateInfo.label,
    location: '',
    events: []
  };
  
  const updatedDays = [...days, newDay];
  await updateTrip({ days: updatedDays });
  render();
}

async function deleteDay(index) {
  const updatedDays = currentTrip.days.filter((_, i) => i !== index);
  await updateTrip({ days: updatedDays });
  render();
}

async function editDayLocation(dayIndex) {
  const currentLocation = currentTrip.days[dayIndex].location || '';
  const newLocation = prompt('Enter location for this day:', currentLocation);
  
  if (newLocation === null) return; // User cancelled
  
  const updatedDays = [...currentTrip.days];
  updatedDays[dayIndex] = { ...updatedDays[dayIndex], location: newLocation.trim() };
  
  await updateTrip({ days: updatedDays });
  render();
}

async function addEvent(dayIndex) {
  // Replaced by showAddEventModal()
  showAddEventModal(dayIndex);
}

function showAddEventModal(dayIndex, eventIndex = null) {
  const isEdit = eventIndex !== null;
  const event = isEdit ? currentTrip.days[dayIndex].events[eventIndex] : {};
  
  // Parse existing time if present, otherwise default to 12:00 PM
  let hour = '12', minute = '00', period = 'PM';
  if (event.time) {
    const timeMatch = event.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (timeMatch) {
      hour = timeMatch[1];
      minute = timeMatch[2];
      period = timeMatch[3].toUpperCase();
    }
  }
  
  const modal = document.createElement('div');
  modal.id = 'event-modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
      <h3 class="text-xl font-semibold mb-4">${isEdit ? 'Edit' : 'Add'} Activity</h3>
      
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Time (optional)</label>
          <div class="flex gap-2">
            <input type="number" id="event-hour" value="${hour}" placeholder="HH" min="1" max="12" class="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
            <span class="flex items-center">:</span>
            <input type="number" id="event-minute" value="${minute}" placeholder="MM" min="0" max="59" class="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
            <select id="event-period" class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
              <option value="AM" ${period === 'AM' ? 'selected' : ''}>AM</option>
              <option value="PM" ${period === 'PM' ? 'selected' : ''}>PM</option>
            </select>
          </div>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input type="text" id="event-title" value="${event.title || ''}" placeholder="e.g., Arrive in London" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select id="event-type" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
            <option value="activity" ${event.type === 'activity' ? 'selected' : ''}>Activity</option>
            <option value="travel" ${event.type === 'travel' ? 'selected' : ''}>Travel</option>
            <option value="food" ${event.type === 'food' ? 'selected' : ''}>Food</option>
            <option value="entertainment" ${event.type === 'entertainment' ? 'selected' : ''}>Entertainment</option>
            <option value="accommodation" ${event.type === 'accommodation' ? 'selected' : ''}>Accommodation</option>
          </select>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Location (optional)</label>
          <input type="text" id="event-location" value="${event.location || ''}" placeholder="e.g., Tower of London" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Link (optional)</label>
          <input type="url" id="event-link" value="${event.link || ''}" placeholder="https://..." class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Rating (optional)</label>
          <div class="flex gap-1" id="star-rating">
            ${[1, 2, 3, 4, 5].map(star => `
              <button type="button" onclick="setRating(${star})" class="star-btn text-2xl focus:outline-none transition-colors ${
                (event.rating && star <= event.rating) ? 'text-yellow-400' : 'text-gray-300'
              } hover:text-yellow-400">
                ★
              </button>
            `).join('')}
          </div>
          <input type="hidden" id="event-rating" value="${event.rating || ''}">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
          <textarea id="event-notes" rows="3" placeholder="Add any notes, thoughts, or recommendations..." class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none">${event.notes || ''}</textarea>
        </div>
      </div>
      
      <div class="flex gap-3 mt-6">
        <button onclick="closeEventModal()" class="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button onclick="saveEvent(${dayIndex}, ${eventIndex})" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          ${isEdit ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.getElementById('event-hour').focus();
}

function closeEventModal() {
  const modal = document.getElementById('event-modal');
  if (modal) modal.remove();
}

function setRating(rating) {
  document.getElementById('event-rating').value = rating;
  
  // Update star display
  const stars = document.querySelectorAll('.star-btn');
  stars.forEach((star, index) => {
    if (index < rating) {
      star.classList.remove('text-gray-300');
      star.classList.add('text-yellow-400');
    } else {
      star.classList.remove('text-yellow-400');
      star.classList.add('text-gray-300');
    }
  });
}

async function saveEvent(dayIndex, eventIndex) {
  const hour = document.getElementById('event-hour').value.trim();
  const minute = document.getElementById('event-minute').value.trim();
  const period = document.getElementById('event-period').value;
  const title = document.getElementById('event-title').value.trim();
  const type = document.getElementById('event-type').value;
  const location = document.getElementById('event-location').value.trim();
  const link = document.getElementById('event-link').value.trim();
  const rating = document.getElementById('event-rating').value;
  const notes = document.getElementById('event-notes').value.trim();
  
  if (!title) {
    alert('Please enter a title');
    return;
  }
  
  // Format time if hour and minute are provided
  let time = '';
  if (hour && minute) {
    const paddedMinute = minute.padStart(2, '0');
    time = `${hour}:${paddedMinute} ${period}`;
  }
  
  const eventData = { time, title, type, location, link, rating: rating ? parseInt(rating) : null, notes, confirmed: false };
  
  const updatedDays = [...currentTrip.days];
  
  if (eventIndex !== null) {
    updatedDays[dayIndex].events[eventIndex] = { ...updatedDays[dayIndex].events[eventIndex], ...eventData };
  } else {
    updatedDays[dayIndex].events = [...(updatedDays[dayIndex].events || []), eventData];
  }
  
  // Sort events by time
  updatedDays[dayIndex].events = sortEventsByTime(updatedDays[dayIndex].events);
  
  await updateTrip({ days: updatedDays });
  closeEventModal();
  render();
}

function editEvent(dayIndex, eventIndex) {
  showAddEventModal(dayIndex, eventIndex);
}

async function deleteEvent(dayIndex, eventIndex) {
  const updatedDays = [...currentTrip.days];
  updatedDays[dayIndex].events = updatedDays[dayIndex].events.filter((_, i) => i !== eventIndex);
  
  await updateTrip({ days: updatedDays });
  render();
}

async function addAccommodation() {
  // Replaced by showAddAccommodationModal()
  showAddAccommodationModal();
}

function showAddAccommodationModal(index = null) {
  const isEdit = index !== null;
  const acc = isEdit ? currentTrip.accommodations[index] : {};
  
  const modal = document.createElement('div');
  modal.id = 'accommodation-modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
      <h3 class="text-xl font-semibold mb-4">${isEdit ? 'Edit' : 'Add'} Accommodation</h3>
      
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input type="text" id="acc-name" value="${acc.name || ''}" placeholder="e.g., Ruby Lucy Hotel" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Location</label>
          <input type="text" id="acc-location" value="${acc.location || ''}" placeholder="e.g., London" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Dates</label>
          <input type="text" id="acc-dates" value="${acc.dates || ''}" placeholder="e.g., Mar 30 - Apr 4" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Booking Link (optional)</label>
          <input type="url" id="acc-link" value="${acc.link || ''}" placeholder="https://..." class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
      </div>
      
      <div class="flex gap-3 mt-6">
        <button onclick="closeAccommodationModal()" class="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button onclick="saveAccommodation(${index})" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          ${isEdit ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.getElementById('acc-name').focus();
}

function closeAccommodationModal() {
  const modal = document.getElementById('accommodation-modal');
  if (modal) modal.remove();
}

async function saveAccommodation(index) {
  const name = document.getElementById('acc-name').value.trim();
  const location = document.getElementById('acc-location').value.trim();
  const dates = document.getElementById('acc-dates').value.trim();
  const link = document.getElementById('acc-link').value.trim();
  
  if (!name || !location) {
    alert('Please fill in Name and Location');
    return;
  }
  
  const accData = { name, location, dates, link, confirmed: false };
  
  if (index !== null) {
    const updatedAccommodations = [...currentTrip.accommodations];
    updatedAccommodations[index] = { ...updatedAccommodations[index], ...accData };
    await updateTrip({ accommodations: updatedAccommodations });
  } else {
    const updatedAccommodations = [...(currentTrip.accommodations || []), accData];
    await updateTrip({ accommodations: updatedAccommodations });
  }
  
  closeAccommodationModal();
  render();
}

function editAccommodation(index) {
  showAddAccommodationModal(index);
}

async function deleteAccommodation(index) {
  const updatedAccommodations = currentTrip.accommodations.filter((_, i) => i !== index);
  await updateTrip({ accommodations: updatedAccommodations });
  render();
}

async function toggleAccommodationConfirmed(index) {
  const updatedAccommodations = [...currentTrip.accommodations];
  updatedAccommodations[index].confirmed = !updatedAccommodations[index].confirmed;
  await updateTrip({ accommodations: updatedAccommodations });
  render();
}

async function addTravel() {
  // This function is now replaced by showAddTravelModal()
  showAddTravelModal();
}

function showAddTravelModal(index = null) {
  const isEdit = index !== null;
  const travel = isEdit ? currentTrip.travel[index] : {};
  
  const modal = document.createElement('div');
  modal.id = 'travel-modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
      <h3 class="text-xl font-semibold mb-4">${isEdit ? 'Edit' : 'Add'} Travel</h3>
      
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select id="travel-type" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
            <option value="Flight" ${travel.type === 'Flight' ? 'selected' : ''}>Flight</option>
            <option value="Train" ${travel.type === 'Train' ? 'selected' : ''}>Train</option>
            <option value="Bus" ${travel.type === 'Bus' ? 'selected' : ''}>Bus</option>
            <option value="Car rental" ${travel.type === 'Car rental' ? 'selected' : ''}>Car rental</option>
            <option value="Ferry" ${travel.type === 'Ferry' ? 'selected' : ''}>Ferry</option>
            <option value="Other" ${travel.type === 'Other' ? 'selected' : ''}>Other</option>
          </select>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Direction/Route</label>
          <input type="text" id="travel-direction" value="${travel.direction || ''}" placeholder="e.g., Outbound, Return, NYC → London" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input type="text" id="travel-date" value="${travel.date || ''}" placeholder="e.g., Mar 30" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Route</label>
          <input type="text" id="travel-route" value="${travel.route || ''}" placeholder="e.g., LAX → LHR" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Details (time, airline, etc.)</label>
          <input type="text" id="travel-details" value="${travel.details || ''}" placeholder="e.g., 10:30 AM, British Airways" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Booking Link (optional)</label>
          <input type="url" id="travel-link" value="${travel.link || ''}" placeholder="https://..." class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
      </div>
      
      <div class="flex gap-3 mt-6">
        <button onclick="closeTravelModal()" class="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button onclick="saveTravel(${index})" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          ${isEdit ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.getElementById('travel-type').focus();
}

function closeTravelModal() {
  const modal = document.getElementById('travel-modal');
  if (modal) modal.remove();
}

async function saveTravel(index) {
  const type = document.getElementById('travel-type').value;
  const direction = document.getElementById('travel-direction').value.trim();
  const date = document.getElementById('travel-date').value.trim();
  const route = document.getElementById('travel-route').value.trim();
  const details = document.getElementById('travel-details').value.trim();
  const link = document.getElementById('travel-link').value.trim();
  
  if (!type || !direction) {
    alert('Please fill in Type and Direction');
    return;
  }
  
  const travelData = { type, direction, date, route, details, link, confirmed: false };
  
  if (index !== null) {
    // Edit existing
    const updatedTravel = [...currentTrip.travel];
    updatedTravel[index] = { ...updatedTravel[index], ...travelData };
    await updateTrip({ travel: updatedTravel });
  } else {
    // Add new
    const updatedTravel = [...(currentTrip.travel || []), travelData];
    await updateTrip({ travel: updatedTravel });
  }
  
  closeTravelModal();
  render();
}

function editTravel(index) {
  showAddTravelModal(index);
}

async function editTravelLink(index) {
  const link = prompt('Paste booking link:', currentTrip.travel[index].link);
  if (link === null) return;
  
  const updatedTravel = [...currentTrip.travel];
  updatedTravel[index] = { ...updatedTravel[index], link };
  await updateTrip({ travel: updatedTravel });
  render();
}

async function deleteTravel(index) {
  const updatedTravel = currentTrip.travel.filter((_, i) => i !== index);
  await updateTrip({ travel: updatedTravel });
  render();
}

async function toggleTravelConfirmed(index) {
  const updatedTravel = [...currentTrip.travel];
  updatedTravel[index].confirmed = !updatedTravel[index].confirmed;
  await updateTrip({ travel: updatedTravel });
  render();
}

async function addPackingItem() {
  const item = prompt('Item to pack:');
  if (!item) return;
  
  const newItem = { item, packed: false };
  const updatedList = [...(currentTrip.packingList || []), newItem];
  
  await updateTrip({ packingList: updatedList });
  render();
}

async function deletePackingItem(index) {
  const updatedList = currentTrip.packingList.filter((_, i) => i !== index);
  await updateTrip({ packingList: updatedList });
  render();
}

async function togglePacked(index) {
  const updatedList = [...currentTrip.packingList];
  updatedList[index].packed = !updatedList[index].packed;
  await updateTrip({ packingList: updatedList });
  render();
}

async function addNote() {
  const note = prompt('Add a note:');
  if (!note) return;
  
  const updatedNotes = [...(currentTrip.notes || []), note];
  await updateTrip({ notes: updatedNotes });
  render();
}

async function deleteNote(index) {
  const updatedNotes = currentTrip.notes.filter((_, i) => i !== index);
  await updateTrip({ notes: updatedNotes });
  render();
}

// ==================== PHOTO FUNCTIONS ====================

function showUploadPhotoModal() {
  const modal = document.createElement('div');
  modal.id = 'photo-upload-modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
      <h3 class="text-xl font-semibold mb-4">Upload Photo</h3>
      
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Select Photo</label>
          <input type="file" id="photo-file" accept="image/*" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
          <p class="text-xs text-gray-500 mt-1">JPG, PNG, GIF up to 10MB</p>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Caption (optional)</label>
          <input type="text" id="photo-caption" placeholder="e.g., Sunset at Tower Bridge" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div id="upload-progress" class="hidden">
          <div class="w-full bg-gray-200 rounded-full h-2">
            <div id="upload-progress-bar" class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
          </div>
          <p class="text-sm text-gray-600 mt-1 text-center">Uploading...</p>
        </div>
      </div>
      
      <div class="flex gap-3 mt-6">
        <button onclick="closePhotoUploadModal()" class="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button onclick="uploadPhoto()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Upload
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function closePhotoUploadModal() {
  const modal = document.getElementById('photo-upload-modal');
  if (modal) modal.remove();
}

async function uploadPhoto() {
  const fileInput = document.getElementById('photo-file');
  const caption = document.getElementById('photo-caption').value.trim();
  
  if (!fileInput.files || !fileInput.files[0]) {
    alert('Please select a photo');
    return;
  }
  
  const file = fileInput.files[0];
  
  // Check file size (10MB limit)
  if (file.size > 10 * 1024 * 1024) {
    alert('File size must be less than 10MB');
    return;
  }
  
  // Show progress
  document.getElementById('upload-progress').classList.remove('hidden');
  document.getElementById('upload-progress-bar').style.width = '30%';
  
  try {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('caption', caption);
    
    const headers = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(`${API_URL}/api/trips/${currentTrip.id}/upload-photo`, {
      method: 'POST',
      headers,
      body: formData
    });
    
    document.getElementById('upload-progress-bar').style.width = '90%';
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Upload failed');
    }
    
    document.getElementById('upload-progress-bar').style.width = '100%';
    
    // Reload trip data
    await loadTrips();
    currentTrip = trips.find(t => t.id === currentTrip.id);
    
    closePhotoUploadModal();
    render();
  } catch (error) {
    alert('Upload failed: ' + error.message);
    document.getElementById('upload-progress').classList.add('hidden');
  }
}

async function deletePhoto(photoId) {
  if (!confirm('Delete this photo? This cannot be undone.')) {
    return;
  }
  
  try {
    const response = await apiCall(`/api/trips/${currentTrip.id}/photos/${photoId}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Delete failed');
    }
    
    // Reload trip data
    await loadTrips();
    currentTrip = trips.find(t => t.id === currentTrip.id);
    render();
  } catch (error) {
    alert('Delete failed: ' + error.message);
  }
}

function showPhotoLightbox(photoId) {
  const photo = currentTrip.memories?.photos?.find(p => p.id === photoId);
  if (!photo) return;
  
  const allPhotos = currentTrip.memories.photos;
  const currentIndex = allPhotos.findIndex(p => p.id === photoId);
  
  const modal = document.createElement('div');
  modal.id = 'photo-lightbox';
  modal.className = 'fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50';
  modal.onclick = (e) => { if (e.target === modal) closeLightbox(); };
  
  modal.innerHTML = `
    <div class="relative max-w-4xl w-full">
      <button onclick="closeLightbox()" class="absolute top-4 right-4 text-white hover:text-gray-300 z-10">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      
      ${currentIndex > 0 ? `
        <button onclick="navigateLightbox(${currentIndex - 1})" class="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black/50 rounded-full p-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
      ` : ''}
      
      ${currentIndex < allPhotos.length - 1 ? `
        <button onclick="navigateLightbox(${currentIndex + 1})" class="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 bg-black/50 rounded-full p-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      ` : ''}
      
      <img src="${API_URL}/api/photos/${photo.key}" alt="${photo.caption || 'Trip photo'}" class="w-full h-auto max-h-[80vh] object-contain rounded-lg">
      
      ${photo.caption ? `
        <div class="mt-4 text-center">
          <p class="text-white text-lg">${photo.caption}</p>
        </div>
      ` : ''}
      
      <div class="mt-2 text-center">
        <p class="text-gray-400 text-sm">${currentIndex + 1} / ${allPhotos.length}</p>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

function navigateLightbox(index) {
  const allPhotos = currentTrip.memories.photos;
  if (index >= 0 && index < allPhotos.length) {
    closeLightbox();
    showPhotoLightbox(allPhotos[index].id);
  }
}

function closeLightbox() {
  const modal = document.getElementById('photo-lightbox');
  if (modal) modal.remove();
}

async function saveHighlights() {
  const highlights = document.getElementById('trip-highlights')?.value || '';
  
  const memories = {
    ...currentTrip.memories,
    highlights: highlights
  };
  
  await updateTrip({ memories });
}

// ==================== HELPER FUNCTIONS ====================

function formatDateShort(dateStr) {
  if (!dateStr) return 'TBD';
  try {
    const date = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  } catch {
    return dateStr;
  }
}

function getLocationColor(location) {
  if (!location) return 'bg-gray-500';
  const loc = location.toLowerCase();
  if (loc.includes('london')) return 'bg-red-500';
  if (loc.includes('edinburgh')) return 'bg-blue-500';
  if (loc.includes('manchester')) return 'bg-purple-500';
  if (loc.includes('liverpool')) return 'bg-orange-500';
  if (loc.includes('oxford')) return 'bg-indigo-500';
  if (loc.includes('cambridge')) return 'bg-teal-500';
  return 'bg-green-500';
}

async function addTravelLink(index) {
  const link = prompt('Paste confirmation link:');
  if (link === null) return;
  
  const updatedTravel = [...currentTrip.travel];
  updatedTravel[index] = { ...updatedTravel[index], link };
  await updateTrip({ travel: updatedTravel });
  render();
}

async function updateAccommodationLink(index) {
  const link = prompt('Paste hotel confirmation link:', currentTrip.accommodations[index].link);
  if (link === null) return;
  
  const updatedAccommodations = [...currentTrip.accommodations];
  updatedAccommodations[index] = { ...updatedAccommodations[index], link };
  await updateTrip({ accommodations: updatedAccommodations });
  render();
}

// ==================== TRIP SHARING FUNCTIONS ====================

async function shareTrip(email) {
  if (!currentTrip || !email) return;
  
  // Determine the correct endpoint based on ownership
  const tripId = currentTrip.id;
  const ownerId = currentTrip.ownerId || currentTrip.userId;
  
  const response = await fetch(`${API_URL}/api/trips/${tripId}/share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentToken}`
    },
    body: JSON.stringify({ email })
  });
  
  const data = await response.json();
  if (data.success) {
    // Refresh trip data
    await loadTrips();
    const updatedTrip = trips.find(t => t.id === tripId);
    if (updatedTrip) {
      currentTrip = updatedTrip;
    }
    alert(data.message);
    render();
  } else {
    alert(data.error || 'Failed to share trip');
  }
}

async function unshareTrip(email) {
  if (!currentTrip || !email) return;
  
  const tripId = currentTrip.id;
  
  const response = await fetch(`${API_URL}/api/trips/${tripId}/unshare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentToken}`
    },
    body: JSON.stringify({ email })
  });
  
  const data = await response.json();
  if (data.success) {
    await loadTrips();
    const updatedTrip = trips.find(t => t.id === tripId);
    if (updatedTrip) {
      currentTrip = updatedTrip;
    }
    alert(data.message);
    render();
  } else {
    alert(data.error || 'Failed to unshare trip');
  }
}

function showShareModal() {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-md">
      <h3 class="text-xl font-semibold mb-4">Share Trip</h3>
      <p class="text-sm text-gray-600 mb-4">Invite someone to view and edit this trip with you.</p>
      
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Email address</label>
          <input type="email" id="share-email" class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="friend@example.com">
        </div>
        
        ${currentTrip.collaborators?.length ? `
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Currently shared with:</label>
            <div class="space-y-2">
              ${currentTrip.collaborators.map(c => `
                <div class="flex justify-between items-center p-2 bg-gray-50 rounded">
                  <span class="text-sm">${c.email}</span>
                  <button onclick="unshareTrip('${c.email}'); this.closest('.fixed').remove();" class="text-red-500 text-sm hover:underline">Remove</button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        <div class="flex gap-3 pt-4">
          <button onclick="this.closest('.fixed').remove()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 transition">Cancel</button>
          <button onclick="const email = document.getElementById('share-email').value; if (email) { shareTrip(email); this.closest('.fixed').remove(); }" class="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition">Share</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('share-email').focus();
}

function getTypeColor(type) {
  const colors = {
    travel: 'bg-blue-100 text-blue-700',
    entertainment: 'bg-purple-100 text-purple-700',
    food: 'bg-orange-100 text-orange-700',
    activity: 'bg-green-100 text-green-700',
    accommodation: 'bg-amber-100 text-amber-700'
  };
  return colors[type] || 'bg-gray-100 text-gray-700';
}

function showEditStatsModal() {
  const trip = currentTrip;
  const stats = trip.stats || {};
  
  const modal = document.createElement('div');
  modal.id = 'stats-modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
      <h3 class="text-xl font-semibold mb-4">Edit Trip Stats</h3>
      
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Total Days</label>
          <input type="number" id="stats-totalDays" value="${stats.totalDays ?? (trip.days?.length || 0)}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Number of Cities</label>
          <input type="number" id="stats-cityCount" value="${stats.cityCount ?? 2}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">City 1 Name</label>
            <input type="text" id="stats-city1Name" value="${stats.city1Name || 'London'}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Days in City 1</label>
            <input type="number" id="stats-city1Days" value="${stats.city1Days ?? 5}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
          </div>
        </div>
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">City 2 Name</label>
            <input type="text" id="stats-city2Name" value="${stats.city2Name || 'Edinburgh'}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Days in City 2</label>
            <input type="number" id="stats-city2Days" value="${stats.city2Days ?? 4}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
          </div>
        </div>
      </div>
      
      <div class="flex gap-3 mt-6">
        <button onclick="closeStatsModal()" class="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button onclick="saveStats()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Save
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.getElementById('stats-totalDays').focus();
}

function closeStatsModal() {
  const modal = document.getElementById('stats-modal');
  if (modal) modal.remove();
}

async function saveStats() {
  const totalDays = parseInt(document.getElementById('stats-totalDays').value) || 0;
  const cityCount = parseInt(document.getElementById('stats-cityCount').value) || 0;
  const city1Name = document.getElementById('stats-city1Name').value.trim() || 'City 1';
  const city1Days = parseInt(document.getElementById('stats-city1Days').value) || 0;
  const city2Name = document.getElementById('stats-city2Name').value.trim() || 'City 2';
  const city2Days = parseInt(document.getElementById('stats-city2Days').value) || 0;
  
  const stats = {
    totalDays,
    cityCount,
    city1Name,
    city1Days,
    city2Name,
    city2Days
  };
  
  await updateTrip({ stats });
  closeStatsModal();
  render();
}

// ==================== COLLABORATION FUNCTIONS ====================

function showCollaboratorsModal() {
  const modal = document.createElement('div');
  modal.id = 'collaborators-modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50';
  
  const collaborators = currentTrip.collaborators || [];
  
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-xl font-semibold">Share Trip</h3>
        <button onclick="closeCollaboratorsModal()" class="text-gray-400 hover:text-gray-600">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      
      <div class="mb-6">
        <label class="block text-sm font-medium text-gray-700 mb-2">Invite by email (if they have an account)</label>
        <div class="flex gap-2">
          <input type="email" id="collaborator-email" placeholder="friend@example.com" class="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
          <button onclick="addCollaborator()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">
            Add
          </button>
        </div>
        <div id="collaborator-error" class="hidden mt-2 text-sm text-red-600"></div>
        <div id="collaborator-success" class="hidden mt-2 text-sm text-green-600"></div>
      </div>
      
      <div class="mb-6 pb-6 border-b border-gray-200">
        <label class="block text-sm font-medium text-gray-700 mb-2">Or share with invite link</label>
        <p class="text-xs text-gray-500 mb-3">Anyone with this link can join the trip (expires in 7 days)</p>
        <button onclick="generateInviteLink()" class="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-medium flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          Generate Invite Link
        </button>
        <div id="invite-link-container" class="hidden mt-3">
          <div class="flex gap-2">
            <input type="text" id="invite-link-input" readonly class="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono">
            <button onclick="copyInviteLink()" class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition font-medium">
              Copy
            </button>
          </div>
          <p class="text-xs text-gray-500 mt-2">Share this link with anyone you want to invite</p>
        </div>
      </div>
      
      <div>
        <h4 class="text-sm font-medium text-gray-700 mb-3">People with access</h4>
        <div class="space-y-2">
          <!-- Owner -->
          <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-medium text-sm">
                ${currentUser.email.charAt(0).toUpperCase()}
              </div>
              <div>
                <div class="text-sm font-medium text-gray-900">${currentUser.email}</div>
                <div class="text-xs text-gray-500">Owner</div>
              </div>
            </div>
          </div>
          
          <!-- Collaborators -->
          ${collaborators.length > 0 ? collaborators.map(collab => `
            <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white font-medium text-sm">
                  ${collab.email.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div class="text-sm font-medium text-gray-900">${collab.email}</div>
                  <div class="text-xs text-gray-500">Can edit</div>
                </div>
              </div>
              <button onclick="removeCollaborator('${collab.email}')" class="text-red-600 hover:text-red-700 text-sm">
                Remove
              </button>
            </div>
          `).join('') : `
            <p class="text-sm text-gray-500 text-center py-4">No collaborators yet</p>
          `}
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.getElementById('collaborator-email').focus();
}

function closeCollaboratorsModal() {
  const modal = document.getElementById('collaborators-modal');
  if (modal) modal.remove();
}

async function addCollaborator() {
  const email = document.getElementById('collaborator-email').value.trim();
  const errorDiv = document.getElementById('collaborator-error');
  const successDiv = document.getElementById('collaborator-success');
  
  errorDiv.classList.add('hidden');
  successDiv.classList.add('hidden');
  
  if (!email || !email.includes('@')) {
    errorDiv.textContent = 'Please enter a valid email address';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  if (email === currentUser.email) {
    errorDiv.textContent = 'You cannot add yourself as a collaborator';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  try {
    const response = await apiCall(`/api/trips/${currentTrip.id}/collaborators`, {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    
    const data = await response.json();
    
    if (data.success) {
      successDiv.textContent = `${email} added successfully!`;
      successDiv.classList.remove('hidden');
      
      // Update current trip with new collaborators
      currentTrip.collaborators = data.collaborators;
      
      // Clear input
      document.getElementById('collaborator-email').value = '';
      
      // Refresh modal
      setTimeout(() => {
        closeCollaboratorsModal();
        showCollaboratorsModal();
      }, 1000);
    } else {
      errorDiv.textContent = data.error || 'Failed to add collaborator';
      errorDiv.classList.remove('hidden');
    }
  } catch (error) {
    errorDiv.textContent = 'Failed to add collaborator. Please try again.';
    errorDiv.classList.remove('hidden');
  }
}

async function removeCollaborator(email) {
  if (!confirm(`Remove ${email} from this trip?`)) {
    return;
  }
  
  try {
    const response = await apiCall(`/api/trips/${currentTrip.id}/collaborators/${encodeURIComponent(email)}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Update current trip
      currentTrip.collaborators = data.collaborators;
      
      // Refresh modal
      closeCollaboratorsModal();
      showCollaboratorsModal();
    } else {
      alert(data.error || 'Failed to remove collaborator');
    }
  } catch (error) {
    alert('Failed to remove collaborator. Please try again.');
  }
}

async function generateInviteLink() {
  try {
    const response = await apiCall(`/api/trips/${currentTrip.id}/invite-link`, {
      method: 'POST'
    });
    
    const data = await response.json();
    
    if (data.success) {
      const origin = window.location.origin;
      const inviteUrl = `${origin}?invite=${data.inviteToken}`;
      
      // Show the invite link
      document.getElementById('invite-link-container').classList.remove('hidden');
      document.getElementById('invite-link-input').value = inviteUrl;
    } else {
      alert(data.error || 'Failed to generate invite link');
    }
  } catch (error) {
    alert('Failed to generate invite link. Please try again.');
  }
}

function copyInviteLink() {
  const input = document.getElementById('invite-link-input');
  input.select();
  document.execCommand('copy');
  
  // Show feedback
  const button = event.target;
  const originalText = button.textContent;
  button.textContent = 'Copied!';
  button.classList.add('bg-green-600');
  button.classList.remove('bg-gray-600');
  
  setTimeout(() => {
    button.textContent = originalText;
    button.classList.remove('bg-green-600');
    button.classList.add('bg-gray-600');
  }, 2000);
}

async function acceptInviteToken(inviteToken) {
  try {
    const response = await apiCall('/api/accept-invite', {
      method: 'POST',
      body: JSON.stringify({
        inviteToken,
        userId: currentUser.id
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Show success message
      alert(data.message);
      
      // Reload trips to show the new shared trip
      await loadTrips();
      
      // Navigate to the trip if we have the ID
      if (data.tripId) {
        const trip = trips.find(t => t.id === data.tripId);
        if (trip) {
          currentTrip = trip;
          render();
        }
      } else {
        renderTripList();
      }
    } else {
      alert(data.error || 'Failed to accept invite');
      renderTripList();
    }
  } catch (error) {
    alert('Failed to accept invite. Please try again.');
    renderTripList();
  }
}

// ==================== TRAVEL GUIDE FUNCTIONS ====================

let currentGuide = null;

async function checkIfGuideExists() {
  if (!currentTrip) return null;
  
  try {
    const response = await apiCall(`/api/trips/${currentTrip.id}/guide`);
    const data = await response.json();
    return data.guide;
  } catch (error) {
    console.error('Error checking guide:', error);
    return null;
  }
}

async function createTravelGuide() {
  if (!currentTrip) return;
  
  // Check if guide already exists
  const existingGuide = await checkIfGuideExists();
  if (existingGuide) {
    if (confirm('A travel guide already exists for this trip. Do you want to edit it?')) {
      showGuideEditor(existingGuide);
    }
    return;
  }
  
  // Auto-create guide with all content included by default
  const autoGuideData = {
    title: currentTrip.title,
    description: '',
    authorName: '',
    days: currentTrip.days || [], // Include all days by default
    highlights: [],
    tips: [],
    isPublic: true
  };
  
  // Show editor with everything pre-selected
  showGuideEditor(autoGuideData, true);
}

function showGuideEditor(guide, isNewGuide = false) {
  const isEdit = !!guide && !isNewGuide;
  
  const modal = document.createElement('div');
  modal.id = 'guide-editor-modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto';
  
  // For new guides, all days should be checked by default
  const shouldDayBeChecked = (day, index) => {
    if (isNewGuide) return true; // New guide - everything checked
    if (!guide?.days) return false; // No guide data
    return guide.days.some(d => d.label === day.label); // Existing guide - check if included
  };
  
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-3xl my-8 shadow-xl">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h3 class="text-2xl font-semibold">${isEdit ? 'Edit' : 'Create'} Travel Guide</h3>
          ${isNewGuide ? `<p class="text-sm text-gray-500 mt-1">All content is included by default. Uncheck items you want to keep private.</p>` : ''}
        </div>
        <button onclick="closeGuideEditor()" class="text-gray-400 hover:text-gray-600">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      
      <div class="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Guide Title</label>
          <input type="text" id="guide-title" value="${guide?.title || currentTrip.title || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Description <span class="text-gray-400 font-normal">(optional)</span></label>
          <textarea id="guide-description" rows="3" placeholder="Brief overview of your trip..." class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">${guide?.description || ''}</textarea>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-3">${isNewGuide ? 'Days & Activities' : 'Select Days to Include'}</label>
          ${isNewGuide ? `<p class="text-sm text-gray-600 mb-2">✓ All days included. Uncheck any you want to keep private.</p>` : ''}
          <div class="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-3">
            ${(currentTrip.days || []).map((day, index) => `
              <label class="flex items-start gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                <input type="checkbox" id="day-${index}" class="mt-1" ${shouldDayBeChecked(day, index) ? 'checked' : ''}>
                <div class="flex-1">
                  <div class="font-medium">${day.label || `Day ${index + 1}`}</div>
                  <div class="text-sm text-gray-500">${day.location || 'No location'} • ${(day.events || []).length} activities</div>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Highlights <span class="text-gray-400 font-normal">(optional, one per line)</span></label>
          <textarea id="guide-highlights" rows="3" placeholder="e.g., Best fish and chips at The Golden Hind&#10;Amazing views from Arthur's Seat" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">${(guide?.highlights || []).join('\n')}</textarea>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Travel Tips <span class="text-gray-400 font-normal">(optional, one per line)</span></label>
          <textarea id="guide-tips" rows="3" placeholder="e.g., Book train tickets in advance for better prices&#10;Oyster card is essential for London transport" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">${(guide?.tips || []).join('\n')}</textarea>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Author Name <span class="text-gray-400 font-normal">(optional)</span></label>
          <input type="text" id="guide-author" value="${guide?.authorName || ''}" placeholder="Your name" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div class="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
          <input type="checkbox" id="guide-public" ${guide?.isPublic !== false ? 'checked' : ''}>
          <label for="guide-public" class="text-sm text-gray-700">Make this guide public (anyone with the link can view)</label>
        </div>
      </div>
      
      <div class="flex gap-3 mt-6 pt-6 border-t">
        <button onclick="closeGuideEditor()" class="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button onclick="saveGuide(${isEdit})" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          ${isNewGuide ? 'Create & Share' : isEdit ? 'Update Guide' : 'Create Guide'}
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

function closeGuideEditor() {
  const modal = document.getElementById('guide-editor-modal');
  if (modal) modal.remove();
}

async function saveGuide(isEdit) {
  const title = document.getElementById('guide-title').value.trim();
  const description = document.getElementById('guide-description').value.trim();
  const authorName = document.getElementById('guide-author').value.trim();
  const highlightsText = document.getElementById('guide-highlights').value.trim();
  const tipsText = document.getElementById('guide-tips').value.trim();
  const isPublic = document.getElementById('guide-public').checked;
  
  if (!title) {
    alert('Please enter a title for your guide');
    return;
  }
  
  // Get selected days
  const selectedDays = [];
  (currentTrip.days || []).forEach((day, index) => {
    const checkbox = document.getElementById(`day-${index}`);
    if (checkbox && checkbox.checked) {
      selectedDays.push(day);
    }
  });
  
  const highlights = highlightsText ? highlightsText.split('\n').filter(h => h.trim()) : [];
  const tips = tipsText ? tipsText.split('\n').filter(t => t.trim()) : [];
  
  const guideData = {
    title,
    description,
    authorName,
    days: selectedDays,
    highlights,
    tips,
    isPublic
  };
  
  try {
    const method = isEdit ? 'PUT' : 'POST';
    const response = await apiCall(`/api/trips/${currentTrip.id}/guide`, {
      method,
      body: JSON.stringify(guideData)
    });
    
    const data = await response.json();
    
    if (data.success) {
      currentGuide = data.guide;
      closeGuideEditor();
      
      // Show success message with shareable link
      showGuideSuccessModal(data.guide);
    } else {
      alert(data.error || 'Failed to save guide');
    }
  } catch (error) {
    console.error('Save guide error:', error);
    alert('Failed to save guide. Please try again.');
  }
}

function showGuideSuccessModal(guide) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50';
  
  const guideUrl = `${window.location.origin}/#/guide/${guide.id}`;
  
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
      <div class="text-center mb-4">
        <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <h3 class="text-xl font-semibold mb-2">Travel Guide Created!</h3>
        <p class="text-gray-600 text-sm">Your guide is ready to share</p>
      </div>
      
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-2">Shareable Link</label>
        <div class="flex gap-2">
          <input type="text" id="guide-url" value="${guideUrl}" readonly class="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono">
          <button onclick="copyGuideUrl()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Copy
          </button>
        </div>
      </div>
      
      <div class="flex gap-3">
        <button onclick="this.closest('.fixed').remove()" class="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
          Close
        </button>
        <button onclick="viewGuide('${guide.id}')" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          View Guide
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

function copyGuideUrl() {
  const input = document.getElementById('guide-url');
  input.select();
  document.execCommand('copy');
  
  const button = event.target;
  const originalText = button.textContent;
  button.textContent = 'Copied!';
  button.classList.add('bg-green-600');
  button.classList.remove('bg-blue-600');
  
  setTimeout(() => {
    button.textContent = originalText;
    button.classList.remove('bg-green-600');
    button.classList.add('bg-blue-600');
  }, 2000);
}

function viewGuide(guideId) {
  window.location.href = `/#/guide/${guideId}`;
  window.location.reload();
}

async function deleteGuideConfirm() {
  if (!confirm('Are you sure you want to delete this travel guide? This cannot be undone.')) {
    return;
  }
  
  try {
    const response = await apiCall(`/api/trips/${currentTrip.id}/guide`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      currentGuide = null;
      alert('Travel guide deleted successfully');
      render();
    } else {
      alert(data.error || 'Failed to delete guide');
    }
  } catch (error) {
    console.error('Delete guide error:', error);
    alert('Failed to delete guide. Please try again.');
  }
}

async function renderPublicGuide(guideId) {
  const app = document.getElementById('app');
  
  app.innerHTML = `
    <div class="min-h-screen bg-slate-50">
      <div class="max-w-4xl mx-auto p-4">
        <div class="text-center py-12">
          <div class="animate-pulse">Loading guide...</div>
        </div>
      </div>
    </div>
  `;
  
  try {
    const response = await fetch(`${API_URL}/api/guides/${guideId}`);
    const data = await response.json();
    
    if (!data.guide) {
      app.innerHTML = `
        <div class="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div class="text-center">
            <h1 class="text-2xl font-bold text-gray-800 mb-2">Guide Not Found</h1>
            <p class="text-gray-600 mb-4">This travel guide doesn't exist or has been removed.</p>
            <a href="/" class="text-blue-600 hover:text-blue-700">Go to Home</a>
          </div>
        </div>
      `;
      return;
    }
    
    const guide = data.guide;
    
    app.innerHTML = `
      <div class="min-h-screen bg-slate-50">
        <!-- Header -->
        <header class="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-12 px-4">
          <div class="max-w-4xl mx-auto">
            <div class="flex items-center gap-2 text-white/80 text-sm mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
              Travel Guide
            </div>
            <h1 class="text-4xl font-bold mb-3">${guide.title}</h1>
            ${guide.description ? `<p class="text-white/90 text-lg mb-4">${guide.description}</p>` : ''}
            <div class="flex flex-wrap gap-2 mb-4">
              ${(guide.destinations || []).map(d => `
                <span class="px-3 py-1 bg-white/20 rounded-full text-sm">${d}</span>
              `).join('')}
            </div>
            ${guide.authorName ? `
              <div class="flex items-center gap-2 text-white/80 text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                By ${guide.authorName}
              </div>
            ` : ''}
          </div>
        </header>
        
        <main class="max-w-4xl mx-auto px-4 py-8">
          <!-- Highlights -->
          ${guide.highlights && guide.highlights.length > 0 ? `
            <section class="mb-8">
              <h2 class="text-2xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                Highlights
              </h2>
              <div class="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
                <ul class="space-y-3">
                  ${guide.highlights.map(h => `
                    <li class="flex items-start gap-3">
                      <span class="text-blue-600 mt-1">✓</span>
                      <span class="text-gray-700">${h}</span>
                    </li>
                  `).join('')}
                </ul>
              </div>
            </section>
          ` : ''}
          
          <!-- Itinerary -->
          ${guide.days && guide.days.length > 0 ? `
            <section class="mb-8">
              <h2 class="text-2xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                Itinerary
              </h2>
              <div class="space-y-4">
                ${guide.days.map((day, index) => `
                  <div class="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
                    <h3 class="text-xl font-semibold text-gray-800 mb-2">${day.label || `Day ${index + 1}`}</h3>
                    <p class="text-gray-600 mb-4">📍 ${day.location || 'Location not specified'}</p>
                    ${day.events && day.events.length > 0 ? `
                      <div class="space-y-3">
                        ${day.events.map(event => `
                          <div class="flex gap-3 p-3 bg-slate-50 rounded-lg">
                            <span class="text-sm font-medium text-gray-500 w-16">${event.time || 'TBD'}</span>
                            <div class="flex-1">
                              <div class="flex items-center gap-2 mb-1">
                                <span class="font-medium text-gray-800">${event.title}</span>
                                ${event.rating ? `
                                  <div class="flex text-yellow-400 text-sm">
                                    ${'★'.repeat(event.rating)}${'☆'.repeat(5 - event.rating)}
                                  </div>
                                ` : ''}
                              </div>
                              ${event.location ? `<p class="text-sm text-gray-600">📍 ${event.location}</p>` : ''}
                              ${event.notes ? `<p class="text-sm text-gray-600 mt-1 italic">${event.notes}</p>` : ''}
                            </div>
                          </div>
                        `).join('')}
                      </div>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
            </section>
          ` : ''}
          
          <!-- Travel Tips -->
          ${guide.tips && guide.tips.length > 0 ? `
            <section class="mb-8">
              <h2 class="text-2xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                Travel Tips
              </h2>
              <div class="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
                <ul class="space-y-3">
                  ${guide.tips.map(tip => `
                    <li class="flex items-start gap-3">
                      <span class="text-purple-600 mt-1">💡</span>
                      <span class="text-gray-700">${tip}</span>
                    </li>
                  `).join('')}
                </ul>
              </div>
            </section>
          ` : ''}
          
          <!-- Footer -->
          <div class="text-center py-8 border-t border-gray-200">
            <p class="text-gray-500 text-sm mb-2">Created with Travel Planner</p>
            <p class="text-gray-400 text-xs">${guide.views || 0} views</p>
          </div>
        </main>
      </div>
    `;
  } catch (error) {
    console.error('Error loading guide:', error);
    app.innerHTML = `
      <div class="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div class="text-center">
          <h1 class="text-2xl font-bold text-gray-800 mb-2">Error Loading Guide</h1>
          <p class="text-gray-600 mb-4">Failed to load the travel guide. Please try again.</p>
          <a href="/" class="text-blue-600 hover:text-blue-700">Go to Home</a>
        </div>
      </div>
    `;
  }
}

// ==================== AUTH UI FUNCTIONS ====================

function renderLoginScreen() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="min-h-screen bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-bold text-gray-800 mb-2">✈️ Travel Planner</h1>
          <p class="text-gray-600">Plan your perfect trip</p>
        </div>
        
        <div id="auth-content">
          <!-- Login Form -->
          <div id="login-form">
            <h2 class="text-xl font-semibold text-gray-800 mb-4">Sign In</h2>
            <input type="email" id="login-email" placeholder="Email" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-3">
            <input type="password" id="login-password" placeholder="Password" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-4">
            <button onclick="handleLogin()" class="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-medium mb-4">
              Sign In
            </button>
            <div id="login-error" class="hidden mt-3 p-3 bg-red-50 text-red-600 rounded-lg text-sm"></div>
            
            <div class="text-center mt-6">
              <p class="text-sm text-gray-600">
                Don't have an account? 
                <button onclick="showSignupForm()" class="text-blue-600 hover:text-blue-700 font-medium">Sign Up</button>
              </p>
            </div>
          </div>
          
          <!-- Signup Form (hidden by default) -->
          <div id="signup-form" class="hidden">
            <h2 class="text-xl font-semibold text-gray-800 mb-4">Create Account</h2>
            <input type="email" id="signup-email" placeholder="Email" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-3">
            <input type="password" id="signup-password" placeholder="Password (min 8 characters)" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-3">
            <input type="password" id="signup-password-confirm" placeholder="Confirm Password" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-4">
            <button onclick="handleSignup()" class="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-medium mb-4">
              Create Account
            </button>
            <div id="signup-error" class="hidden mt-3 p-3 bg-red-50 text-red-600 rounded-lg text-sm"></div>
            
            <div class="text-center mt-6">
              <p class="text-sm text-gray-600">
                Already have an account? 
                <button onclick="showLoginForm()" class="text-blue-600 hover:text-blue-700 font-medium">Sign In</button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Check if we have an invite token in URL
  const urlParams = new URLSearchParams(window.location.search);
  const inviteToken = urlParams.get('invite');
  if (inviteToken) {
    // Show signup form for invite links
    showSignupForm();
  }
}

function showSignupForm() {
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('signup-form').classList.remove('hidden');
}

function showLoginForm() {
  document.getElementById('signup-form').classList.add('hidden');
  document.getElementById('login-form').classList.remove('hidden');
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');
  
  errorDiv.classList.add('hidden');
  
  if (!email || !email.includes('@')) {
    errorDiv.textContent = 'Please enter a valid email address';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  if (!password) {
    errorDiv.textContent = 'Please enter your password';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      saveAuthToken(data.accessToken, data.userId, data.email, data.refreshToken);
      await init();
    } else {
      errorDiv.textContent = data.error || 'Failed to sign in';
      errorDiv.classList.remove('hidden');
    }
  } catch (error) {
    errorDiv.textContent = 'Failed to sign in. Please try again.';
    errorDiv.classList.remove('hidden');
  }
}

async function handleSignup() {
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const passwordConfirm = document.getElementById('signup-password-confirm').value;
  const errorDiv = document.getElementById('signup-error');
  
  errorDiv.classList.add('hidden');
  
  if (!email || !email.includes('@')) {
    errorDiv.textContent = 'Please enter a valid email address';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  if (!password || password.length < 8) {
    errorDiv.textContent = 'Password must be at least 8 characters';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  if (password !== passwordConfirm) {
    errorDiv.textContent = 'Passwords do not match';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      saveAuthToken(data.accessToken, data.userId, data.email, data.refreshToken);
      
      // Check for invite token
      const urlParams = new URLSearchParams(window.location.search);
      const inviteToken = urlParams.get('invite');
      if (inviteToken) {
        await acceptInviteToken(inviteToken);
      } else {
        await init();
      }
    } else {
      errorDiv.textContent = data.error || 'Failed to create account';
      errorDiv.classList.remove('hidden');
    }
  } catch (error) {
    errorDiv.textContent = 'Failed to create account. Please try again.';
    errorDiv.classList.remove('hidden');
  }
}

async function verifyToken(token) {
  const authContent = document.getElementById('auth-content');
  authContent.innerHTML = '<div class="text-center"><p class="text-gray-600">Verifying...</p></div>';
  
  try {
    const response = await fetch(`${API_URL}/api/auth/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    
    const data = await response.json();
    
    if (data.success) {
      saveAuthToken(data.token, data.userId, data.email);
      
      // Clear URL params
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Check for migration
      await checkMigration();
    } else {
      showLoginError(data.error || 'Invalid or expired link');
      setTimeout(() => renderLoginScreen(), 2000);
    }
  } catch (error) {
    showLoginError('Verification failed. Please try again.');
    setTimeout(() => renderLoginScreen(), 2000);
  }
}

async function checkMigration() {
  try {
    // Check if shared user has trips
    const sharedResponse = await fetch(`${API_URL}/api/trips?userId=${SHARED_USER_ID}`);
    const sharedData = await sharedResponse.json();
    
    if (sharedData.trips && sharedData.trips.length > 0) {
      showMigrationPrompt(sharedData.trips.length);
    } else {
      // No migration needed, load app
      await init();
    }
  } catch (error) {
    console.error('Migration check failed:', error);
    await init();
  }
}

function showLoginError(message) {
  const errorDiv = document.getElementById('login-error');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    document.getElementById('login-success')?.classList.add('hidden');
  }
}

function showLoginSuccess(message) {
  const successDiv = document.getElementById('login-success');
  if (successDiv) {
    successDiv.innerHTML = message;
    successDiv.classList.remove('hidden');
    document.getElementById('login-error')?.classList.add('hidden');
  }
}

// ==================== INITIALIZE ====================

async function init() {
  // Check for guide URL first (public, no auth required)
  const hash = window.location.hash;
  if (hash && hash.startsWith('#/guide/')) {
    const guideId = hash.substring(8);
    await renderPublicGuide(guideId);
    return;
  }
  
  // Check for invite token in URL
  const urlParams = new URLSearchParams(window.location.search);
  const inviteToken = urlParams.get('invite');
  
  if (inviteToken) {
    // Clear the URL parameter
    window.history.replaceState({}, document.title, window.location.pathname);
    
    // Accept the invite
    await acceptInviteToken(inviteToken);
    return;
  }
  
  await loadTrips();
  
  // Check URL for trip routing
  if (hash && hash.startsWith('#trip/')) {
    const slug = hash.substring(6);
    const trip = trips.find(t => slugify(t.title) === slug);
    if (trip) {
      currentTrip = trip;
    }
  }
  
  render();
}

// Start the app
(async function() {
  // Check for public guide URL first (no auth required)
  const hash = window.location.hash;
  if (hash && hash.startsWith('#/guide/')) {
    const guideId = hash.substring(8);
    await renderPublicGuide(guideId);
    return;
  }
  
  // Check if we have auth token
  const hasAuth = loadAuthToken();
  
  if (!hasAuth) {
    renderLoginScreen();
  } else {
    await init();
  }
})();

// Expose functions to window for onclick handlers
window.goHome = goHome;
window.logout = logout;
window.handleLogin = handleLogin;
window.handleSignup = handleSignup;
window.showSignupForm = showSignupForm;
window.showLoginForm = showLoginForm;
window.selectTrip = selectTrip;
window.renderTripList = renderTripList;
window.showCreateTripModal = showCreateTripModal;
window.handleCreateTrip = handleCreateTrip;
window.showEditTripModal = showEditTripModal;
window.handleEditTrip = handleEditTrip;
window.confirmDeleteTrip = confirmDeleteTrip;
window.handleDragStart = handleDragStart;
window.handleDragEnd = handleDragEnd;
window.handleDragOver = handleDragOver;
window.handleDragLeave = handleDragLeave;
window.handleDrop = handleDrop;
window.addDay = addDay;
window.deleteDay = deleteDay;
window.editDayLocation = editDayLocation;
window.addEvent = addEvent;
window.deleteEvent = deleteEvent;
window.editAccommodation = editAccommodation;
window.showAddAccommodationModal = showAddAccommodationModal;
window.closeAccommodationModal = closeAccommodationModal;
window.saveAccommodation = saveAccommodation;
window.showAddEventModal = showAddEventModal;
window.closeEventModal = closeEventModal;
window.setRating = setRating;
window.saveEvent = saveEvent;
window.editEvent = editEvent;
window.deleteAccommodation = deleteAccommodation;
window.toggleAccommodationConfirmed = toggleAccommodationConfirmed;
window.addTravel = addTravel;
window.deleteTravel = deleteTravel;
window.toggleTravelConfirmed = toggleTravelConfirmed;
window.addPackingItem = addPackingItem;
window.deletePackingItem = deletePackingItem;
window.togglePacked = togglePacked;
window.addNote = addNote;
window.deleteNote = deleteNote;
window.showUploadPhotoModal = showUploadPhotoModal;
window.closePhotoUploadModal = closePhotoUploadModal;
window.uploadPhoto = uploadPhoto;
window.deletePhoto = deletePhoto;
window.showPhotoLightbox = showPhotoLightbox;
window.navigateLightbox = navigateLightbox;
window.closeLightbox = closeLightbox;
window.saveHighlights = saveHighlights;
window.getTypeColor = getTypeColor;
window.formatDateShort = formatDateShort;
window.getLocationColor = getLocationColor;
window.addTravelLink = addTravelLink;
window.editTravelLink = editTravelLink;
window.showAddTravelModal = showAddTravelModal;
window.closeTravelModal = closeTravelModal;
window.saveTravel = saveTravel;
window.editTravel = editTravel;
window.updateAccommodationLink = updateAccommodationLink;
window.editEvent = editEvent;
window.showEditStatsModal = showEditStatsModal;
window.closeStatsModal = closeStatsModal;
window.saveStats = saveStats;
window.showCollaboratorsModal = showCollaboratorsModal;
window.closeCollaboratorsModal = closeCollaboratorsModal;
window.addCollaborator = addCollaborator;
window.removeCollaborator = removeCollaborator;
window.generateInviteLink = generateInviteLink;
window.copyInviteLink = copyInviteLink;
window.createTravelGuide = createTravelGuide;
window.showGuideEditor = showGuideEditor;
window.closeGuideEditor = closeGuideEditor;
window.saveGuide = saveGuide;
window.copyGuideUrl = copyGuideUrl;
window.viewGuide = viewGuide;
window.deleteGuideConfirm = deleteGuideConfirm;

// Listen for hash changes (back/forward navigation)
window.addEventListener('hashchange', () => {
  const slug = getTripSlugFromUrl();
  if (slug) {
    const trip = findTripBySlug(slug);
    if (trip && (!currentTrip || currentTrip.id !== trip.id)) {
      currentTrip = trip;
      render();
    }
  } else if (currentTrip) {
    currentTrip = null;
    renderTripList();
  }
});
