// UK Trip Tracker - March 30 - April 8, 2026
// Data is saved to localStorage for persistence

const STORAGE_KEY = 'uk-trip-2026';

const defaultTripData = {
  title: "UK Trip 2026",
  dates: "March 30 - April 8, 2026",
  destinations: ["London", "Edinburgh"],
  
  days: [
    { date: "2026-03-30", dayOfWeek: "Sunday", label: "Day 1 - Arrival", location: "London",
      events: [{ time: "AM", title: "Arrive in London", type: "travel", notes: "", confirmed: true }] },
    { date: "2026-03-31", dayOfWeek: "Monday", label: "Day 2", location: "London", events: [] },
    { date: "2026-04-01", dayOfWeek: "Tuesday", label: "Day 3", location: "London", events: [] },
    { date: "2026-04-02", dayOfWeek: "Wednesday", label: "Day 4", location: "London",
      events: [{ time: "Evening", title: "Opera", type: "entertainment", notes: "", confirmed: true }] },
    { date: "2026-04-03", dayOfWeek: "Thursday", label: "Day 5", location: "London", events: [] },
    { date: "2026-04-04", dayOfWeek: "Friday", label: "Day 6 - Travel to Edinburgh", location: "London → Edinburgh",
      events: [{ time: "TBD", title: "Travel to Edinburgh", type: "travel", notes: "Train or flight?", confirmed: false }] },
    { date: "2026-04-05", dayOfWeek: "Saturday", label: "Day 7", location: "Edinburgh", events: [] },
    { date: "2026-04-06", dayOfWeek: "Sunday", label: "Day 8", location: "Edinburgh", events: [] },
    { date: "2026-04-07", dayOfWeek: "Monday", label: "Day 9", location: "Edinburgh", events: [] },
    { date: "2026-04-08", dayOfWeek: "Tuesday", label: "Day 10 - Departure", location: "Edinburgh",
      events: [{ time: "TBD", title: "Fly home", type: "travel", notes: "", confirmed: false }] }
  ],

  accommodations: [
    { name: "Ruby Lucy Hotel", location: "London", dates: "Mar 30 - Apr 4", link: "", confirmed: true },
    { name: "TBD", location: "Edinburgh", dates: "Apr 4 - Apr 8", link: "", confirmed: false }
  ],

  flights: [
    { direction: "Outbound", date: "Mar 30", route: "→ London", details: "AM arrival", link: "", confirmed: false },
    { direction: "Return", date: "Apr 8", route: "Edinburgh →", details: "TBD", link: "", confirmed: false }
  ],

  packingList: [
    { item: "Passport", packed: false },
    { item: "Phone charger", packed: false },
    { item: "UK power adapter", packed: false },
    { item: "Opera outfit", packed: false },
    { item: "Umbrella", packed: false },
    { item: "Comfortable walking shoes", packed: false }
  ],

  notes: [
    "Weather in late March/early April: 8-14°C (46-57°F), chance of rain",
    "Edinburgh accommodation still needs booking"
  ],

  links: []
};

// Load from localStorage or use defaults
let tripData = JSON.parse(localStorage.getItem(STORAGE_KEY)) || JSON.parse(JSON.stringify(defaultTripData));

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tripData));
}

function getTypeColor(type) {
  const colors = {
    travel: "bg-blue-100 text-blue-700 border-blue-200",
    entertainment: "bg-purple-100 text-purple-700 border-purple-200",
    food: "bg-orange-100 text-orange-700 border-orange-200",
    activity: "bg-green-100 text-green-700 border-green-200",
    accommodation: "bg-amber-100 text-amber-700 border-amber-200"
  };
  return colors[type] || "bg-gray-100 text-gray-700 border-gray-200";
}

function getLocationColor(location) {
  if (location.includes("London")) return "bg-red-500";
  if (location.includes("Edinburgh")) return "bg-blue-500";
  return "bg-gray-500";
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function render() {
  const app = document.getElementById('app');
  
  app.innerHTML = `
    <!-- Header -->
    <header class="bg-gradient-to-r from-red-600 to-blue-600 text-white py-8 px-4">
      <div class="max-w-4xl mx-auto">
        <h1 class="text-3xl font-bold mb-2">🇬🇧 ${tripData.title}</h1>
        <p class="text-white/90 text-lg">${tripData.dates}</p>
        <div class="flex gap-3 mt-4">
          ${tripData.destinations.map(d => `
            <span class="px-3 py-1 bg-white/20 rounded-full text-sm">${d}</span>
          `).join('')}
        </div>
      </div>
    </header>

    <main class="max-w-4xl mx-auto px-4 py-8">
      
      <!-- Quick Stats -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div class="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div class="text-2xl font-bold text-slate-800">10</div>
          <div class="text-sm text-slate-500">Days</div>
        </div>
        <div class="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div class="text-2xl font-bold text-slate-800">2</div>
          <div class="text-sm text-slate-500">Cities</div>
        </div>
        <div class="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div class="text-2xl font-bold text-red-600">5</div>
          <div class="text-sm text-slate-500">Days in London</div>
        </div>
        <div class="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div class="text-2xl font-bold text-blue-600">4</div>
          <div class="text-sm text-slate-500">Days in Edinburgh</div>
        </div>
      </div>

      <!-- Flights -->
      <section class="mb-8">
        <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <i data-lucide="plane" class="w-5 h-5"></i> Flights
        </h2>
        <div class="grid md:grid-cols-2 gap-4">
          ${tripData.flights.map((flight, i) => `
            <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <div class="flex justify-between items-start mb-2">
                <h3 class="font-semibold text-slate-800">${flight.direction}</h3>
                ${flight.link 
                  ? '<span class="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">Has Link</span>'
                  : '<span class="text-xs px-2 py-1 bg-slate-100 text-slate-500 rounded-full">No Link</span>'
                }
              </div>
              <p class="text-sm text-slate-600">${flight.date} ${flight.route}</p>
              <p class="text-sm text-slate-500 mb-3">${flight.details}</p>
              <div class="flex gap-2">
                ${flight.link 
                  ? `<a href="${flight.link}" target="_blank" class="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">View Confirmation</a>`
                  : ''
                }
                <button onclick="updateFlightLink(${i})" class="text-xs px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50">
                  ${flight.link ? 'Update' : 'Add'} Link
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </section>

      <!-- Accommodations -->
      <section class="mb-8">
        <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <i data-lucide="bed" class="w-5 h-5"></i> Accommodations
        </h2>
        <div class="grid md:grid-cols-2 gap-4">
          ${tripData.accommodations.map((acc, i) => `
            <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200 ${!acc.confirmed ? 'border-dashed border-amber-300 bg-amber-50/50' : ''}">
              <div class="flex justify-between items-start mb-2">
                <h3 class="font-semibold text-slate-800">${acc.name}</h3>
                ${acc.confirmed 
                  ? '<span class="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">Confirmed</span>'
                  : '<span class="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full">Pending</span>'
                }
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
          `).join('')}
        </div>
      </section>

      <!-- Day by Day Itinerary -->
      <section class="mb-8">
        <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <i data-lucide="calendar-days" class="w-5 h-5"></i> Day by Day
        </h2>
        <div class="space-y-3">
          ${tripData.days.map((day, dayIndex) => `
            <div class="day-card bg-white rounded-xl p-5 shadow-sm border border-slate-200 transition-all duration-200">
              <div class="flex items-center gap-4 mb-3">
                <div class="w-14 h-14 rounded-lg ${getLocationColor(day.location)} text-white flex flex-col items-center justify-center text-center">
                  <span class="text-xs font-medium">${formatDate(day.date).split(' ')[0]}</span>
                  <span class="text-lg font-bold">${formatDate(day.date).split(' ')[1]}</span>
                </div>
                <div class="flex-1">
                  <h3 class="font-semibold text-slate-800">${day.dayOfWeek} — ${day.label}</h3>
                  <p class="text-sm text-slate-500">📍 ${day.location}</p>
                </div>
                <button onclick="addActivity(${dayIndex})" class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Add activity">
                  <i data-lucide="plus-circle" class="w-5 h-5"></i>
                </button>
              </div>
              
              ${day.events.length > 0 ? `
                <div class="ml-[4.5rem] space-y-2">
                  ${day.events.map((event, eventIndex) => `
                    <div class="group flex items-center gap-3 p-3 rounded-lg border ${getTypeColor(event.type)}">
                      <span class="text-xs font-medium w-16">${event.time}</span>
                      <div class="flex-1">
                        <span class="font-medium">${event.title}</span>
                        ${event.link ? `<a href="${event.link}" target="_blank" class="ml-2 text-xs text-blue-600 hover:underline">🔗 link</a>` : ''}
                      </div>
                      ${!event.confirmed ? '<span class="text-xs opacity-70">(TBC)</span>' : ''}
                      <button onclick="editActivity(${dayIndex}, ${eventIndex})" class="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded" title="Edit">
                        ✏️
                      </button>
                      <button onclick="deleteActivity(${dayIndex}, ${eventIndex})" class="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 rounded" title="Delete">
                        🗑️
                      </button>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <button onclick="addActivity(${dayIndex})" class="ml-[4.5rem] w-[calc(100%-4.5rem)] p-3 rounded-lg border border-dashed border-slate-300 text-slate-400 text-sm hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50 transition-colors">
                  + Add activity
                </button>
              `}
            </div>
          `).join('')}
        </div>
      </section>

      <!-- Packing List -->
      <section class="mb-8">
        <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <i data-lucide="luggage" class="w-5 h-5"></i> Packing List
          <span class="text-sm font-normal text-slate-400">(${tripData.packingList.filter(i => i.packed).length}/${tripData.packingList.length} packed)</span>
        </h2>
        <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
            ${tripData.packingList.map((item, i) => `
              <div class="group flex items-center gap-2 p-2 rounded hover:bg-slate-50">
                <input type="checkbox" ${item.packed ? 'checked' : ''} 
                  onchange="togglePacked(${i})"
                  class="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer">
                <span class="flex-1 ${item.packed ? 'line-through text-slate-400' : 'text-slate-700'}">${item.item}</span>
                <button onclick="deletePackingItem(${i})" class="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 rounded" title="Remove">
                  <i data-lucide="x" class="w-3 h-3"></i>
                </button>
              </div>
            `).join('')}
          </div>
          <button onclick="addPackingItem()" class="w-full p-2 border border-dashed border-slate-300 rounded-lg text-slate-500 text-sm hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50 transition-colors">
            + Add item
          </button>
        </div>
      </section>

      <!-- Notes -->
      <section class="mb-8">
        <h2 class="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <i data-lucide="sticky-note" class="w-5 h-5"></i> Notes
        </h2>
        <div class="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <ul class="space-y-2 mb-4">
            ${tripData.notes.map((note, i) => `
              <li class="group flex items-start gap-2 text-slate-600">
                <span class="text-slate-400">•</span>
                <span class="flex-1">${note}</span>
                <button onclick="deleteNote(${i})" class="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 rounded" title="Delete">
                  <i data-lucide="x" class="w-3 h-3"></i>
                </button>
              </li>
            `).join('')}
          </ul>
          <button onclick="addNote()" class="w-full p-2 border border-dashed border-slate-300 rounded-lg text-slate-500 text-sm hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50 transition-colors">
            + Add note
          </button>
        </div>
      </section>

    </main>

    <!-- Footer -->
    <footer class="text-center py-6 text-slate-400 text-sm">
      Last updated: ${new Date().toLocaleDateString()}
    </footer>
  `;

  // Initialize Lucide icons
  lucide.createIcons();
}

function togglePacked(index) {
  tripData.packingList[index].packed = !tripData.packingList[index].packed;
  saveData();
  render();
}

// Show activity modal
let currentEditDayIndex = null;
let currentEditEventIndex = null;

function showActivityModal(dayIndex, eventIndex = null) {
  currentEditDayIndex = dayIndex;
  currentEditEventIndex = eventIndex;
  
  const isEdit = eventIndex !== null;
  const event = isEdit ? tripData.days[dayIndex].events[eventIndex] : { time: '', title: '', type: 'activity', link: '' };
  const dayLabel = tripData.days[dayIndex].dayOfWeek + ' - ' + tripData.days[dayIndex].label;
  
  const modal = document.createElement('div');
  modal.id = 'activity-modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
      <h3 class="text-lg font-semibold text-slate-800 mb-1">${isEdit ? 'Edit' : 'Add'} Activity</h3>
      <p class="text-sm text-slate-500 mb-4">${dayLabel}</p>
      
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Time</label>
          <input type="text" id="modal-time" value="${event.time}" placeholder="e.g., 9:00 AM, Afternoon, Evening"
            class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Activity Name</label>
          <input type="text" id="modal-title" value="${event.title}" placeholder="What are you doing?"
            class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Type</label>
          <select id="modal-type" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
            <option value="activity" ${event.type === 'activity' ? 'selected' : ''}>Activity</option>
            <option value="food" ${event.type === 'food' ? 'selected' : ''}>Food</option>
            <option value="entertainment" ${event.type === 'entertainment' ? 'selected' : ''}>Entertainment</option>
            <option value="travel" ${event.type === 'travel' ? 'selected' : ''}>Travel</option>
          </select>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Link (optional)</label>
          <input type="url" id="modal-link" value="${event.link || ''}" placeholder="https://..."
            class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
        </div>
      </div>
      
      <div class="flex gap-3 mt-6">
        <button onclick="closeActivityModal()" class="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <button onclick="saveActivityModal()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          ${isEdit ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.getElementById('modal-time').focus();
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeActivityModal();
  });
}

function closeActivityModal() {
  const modal = document.getElementById('activity-modal');
  if (modal) modal.remove();
  currentEditDayIndex = null;
  currentEditEventIndex = null;
}

function saveActivityModal() {
  const time = document.getElementById('modal-time').value.trim();
  const title = document.getElementById('modal-title').value.trim();
  const type = document.getElementById('modal-type').value;
  const link = document.getElementById('modal-link').value.trim();
  
  if (!time || !title) {
    alert('Please fill in Time and Activity Name');
    return;
  }
  
  if (currentEditEventIndex !== null) {
    // Edit existing
    const event = tripData.days[currentEditDayIndex].events[currentEditEventIndex];
    tripData.days[currentEditDayIndex].events[currentEditEventIndex] = { ...event, time, title, type, link };
  } else {
    // Add new
    tripData.days[currentEditDayIndex].events.push({ time, title, type, link, notes: '', confirmed: false });
  }
  
  saveData();
  closeActivityModal();
  render();
}

// Add activity to a day
function addActivity(dayIndex) {
  showActivityModal(dayIndex);
}

// Edit activity
function editActivity(dayIndex, eventIndex) {
  showActivityModal(dayIndex, eventIndex);
}

// Delete activity
function deleteActivity(dayIndex, eventIndex) {
  if (confirm('Delete this activity?')) {
    tripData.days[dayIndex].events.splice(eventIndex, 1);
    saveData();
    render();
  }
}

// Add packing item
function addPackingItem() {
  const item = prompt('Add packing item:');
  if (item && item.trim()) {
    tripData.packingList.push({ item: item.trim(), packed: false });
    saveData();
    render();
  }
}

// Delete packing item
function deletePackingItem(index) {
  tripData.packingList.splice(index, 1);
  saveData();
  render();
}

// Add note
function addNote() {
  const note = prompt('Add a note:');
  if (note && note.trim()) {
    tripData.notes.push(note.trim());
    saveData();
    render();
  }
}

// Delete note
function deleteNote(index) {
  tripData.notes.splice(index, 1);
  saveData();
  render();
}

// Update flight link
function updateFlightLink(index) {
  const link = prompt('Paste flight confirmation link:', tripData.flights[index].link);
  if (link !== null) {
    tripData.flights[index].link = link;
    tripData.flights[index].confirmed = link.length > 0;
    saveData();
    render();
  }
}

// Update accommodation link
function updateAccommodationLink(index) {
  const link = prompt('Paste hotel confirmation link:', tripData.accommodations[index].link);
  if (link !== null) {
    tripData.accommodations[index].link = link;
    saveData();
    render();
  }
}

// Make functions globally accessible
window.togglePacked = togglePacked;
window.addActivity = addActivity;
window.editActivity = editActivity;
window.deleteActivity = deleteActivity;
window.addPackingItem = addPackingItem;
window.deletePackingItem = deletePackingItem;
window.addNote = addNote;
window.deleteNote = deleteNote;
window.updateFlightLink = updateFlightLink;
window.updateAccommodationLink = updateAccommodationLink;
window.closeActivityModal = closeActivityModal;
window.saveActivityModal = saveActivityModal;

// Initial render
render();
