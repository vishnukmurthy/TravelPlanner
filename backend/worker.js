// Cloudflare Worker Backend for Travel Planner App

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const JWT_SECRET = 'your-secret-key-change-in-production'; // TODO: Move to env variable
const ACCESS_TOKEN_EXPIRY = 90 * 24 * 60 * 60; // 90 days in seconds
const REFRESH_TOKEN_EXPIRY = 180 * 24 * 60 * 60; // 180 days in seconds

// Simple JWT encoding (for demo - use proper JWT library in production)
async function createJWT(userId, email, type = 'access') {
  const header = { alg: 'HS256', typ: 'JWT' };
  const expiry = type === 'refresh' ? REFRESH_TOKEN_EXPIRY : ACCESS_TOKEN_EXPIRY;
  
  const payload = {
    userId,
    email,
    type,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiry
  };
  
  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const message = `${encodedHeader}.${encodedPayload}`;
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message)
  );
  
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${message}.${encodedSignature}`;
}

async function verifyJWT(token) {
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    const message = `${encodedHeader}.${encodedPayload}`;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signature = Uint8Array.from(atob(encodedSignature), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(message)
    );
    
    if (!valid) return null;
    
    const payload = JSON.parse(atob(encodedPayload));
    
    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    
    return payload;
  } catch (e) {
    return null;
  }
}

async function getUserFromRequest(request, env) {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  const payload = await verifyJWT(token);
  
  return payload ? payload.userId : null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // Auth endpoints (no auth required)
      if (path === '/api/auth/signup' && method === 'POST') {
        return await signup(request, env);
      }
      if (path === '/api/auth/login' && method === 'POST') {
        return await login(request, env);
      }
      if (path === '/api/auth/refresh' && method === 'POST') {
        return await refreshAccessToken(request, env);
      }
      
      // Get userId from auth token
      let userId = await getUserFromRequest(request, env);
      
      // Require auth for all other endpoints
      if (!userId) {
        return jsonResponse({ error: 'Authentication required' }, 401);
      }

      // Trip endpoints - no auth required
      if (path === '/api/trips' && method === 'GET') {
        return await getTrips(userId, env);
      }
      
      // Debug endpoint to check all trip keys
      if (path === '/api/debug/trips' && method === 'GET') {
        const tripsList = await env.TRAVEL_KV.get(`trips:${userId}`);
        const ownTripIds = tripsList ? JSON.parse(tripsList) : [];
        
        const tripDetails = await Promise.all(
          ownTripIds.map(async (tripId) => {
            const tripData = await env.TRAVEL_KV.get(`trip:${userId}:${tripId}`);
            return tripData ? { id: tripId, exists: true, title: JSON.parse(tripData).title } : { id: tripId, exists: false };
          })
        );
        
        return jsonResponse({ 
          userId, 
          ownTripIds,
          tripDetails,
          message: 'Debug info for trip recovery'
        });
      }
      if (path === '/api/trips' && method === 'POST') {
        return await createTrip(userId, request, env);
      }
      // Collaboration endpoints (must be before generic trip routes)
      if (path.startsWith('/api/trips/') && path.endsWith('/collaborators') && method === 'POST') {
        const tripId = path.split('/')[3];
        return await addCollaborator(userId, tripId, request, env);
      }
      
      if (path.startsWith('/api/trips/') && path.includes('/collaborators/') && method === 'DELETE') {
        const parts = path.split('/');
        const tripId = parts[3];
        const collaboratorEmail = decodeURIComponent(parts[5]);
        return await removeCollaborator(userId, tripId, collaboratorEmail, env);
      }
      
      // Invite link endpoints (must be before generic trip routes)
      if (path.startsWith('/api/trips/') && path.endsWith('/invite-link') && method === 'POST') {
        const tripId = path.split('/')[3];
        return await generateInviteLink(userId, tripId, env);
      }
      
      // Photo upload endpoint (must be before generic trip routes)
      if (path.startsWith('/api/trips/') && path.endsWith('/upload-photo') && method === 'POST') {
        const tripId = path.split('/')[3];
        return await uploadPhoto(userId, tripId, request, env);
      }
      
      // Photo delete endpoint (must be before generic trip DELETE)
      if (path.startsWith('/api/trips/') && path.includes('/photos/') && method === 'DELETE') {
        const parts = path.split('/');
        const tripId = parts[3];
        const photoId = parts[5];
        return await deletePhoto(userId, tripId, photoId, env);
      }
      
      // Serve photo from R2
      if (path.startsWith('/api/photos/') && method === 'GET') {
        const key = path.replace('/api/photos/', '');
        return await servePhoto(key, env);
      }
      
      // Generic trip endpoints (must be after specific routes)
      if (path.startsWith('/api/trips/') && method === 'GET') {
        const tripId = path.split('/')[3];
        return await getTrip(userId, tripId, env);
      }
      if (path.startsWith('/api/trips/') && method === 'PUT') {
        const tripId = path.split('/')[3];
        return await updateTrip(userId, tripId, request, env);
      }
      if (path.startsWith('/api/trips/') && method === 'DELETE') {
        const tripId = path.split('/')[3];
        return await deleteTrip(userId, tripId, env);
      }
      
      if (path === '/api/accept-invite' && method === 'POST') {
        return await acceptInvite(request, env);
      }
      
      // Travel Guide endpoints
      // Public guide viewing (no auth required)
      if (path.startsWith('/api/guides/') && method === 'GET') {
        const guideId = path.split('/')[3];
        return await getPublicGuide(guideId, env);
      }
      
      // Guide management (auth required)
      if (path.startsWith('/api/trips/') && path.endsWith('/guide') && method === 'POST') {
        const tripId = path.split('/')[3];
        return await createGuide(userId, tripId, request, env);
      }
      
      if (path.startsWith('/api/trips/') && path.endsWith('/guide') && method === 'GET') {
        const tripId = path.split('/')[3];
        return await getGuideByTrip(userId, tripId, env);
      }
      
      if (path.startsWith('/api/trips/') && path.endsWith('/guide') && method === 'PUT') {
        const tripId = path.split('/')[3];
        return await updateGuide(userId, tripId, request, env);
      }
      
      if (path.startsWith('/api/trips/') && path.endsWith('/guide') && method === 'DELETE') {
        const tripId = path.split('/')[3];
        return await deleteGuide(userId, tripId, env);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  }
};

// ==================== PASSWORD HASHING ====================

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, hashedPassword) {
  const hash = await hashPassword(password);
  return hash === hashedPassword;
}

// ==================== AUTH FUNCTIONS ====================

async function signup(request, env) {
  try {
    const { email, password } = await request.json();
    
    if (!email || !email.includes('@')) {
      return jsonResponse({ error: 'Valid email required' }, 400);
    }
    
    if (!password || password.length < 8) {
      return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
    }
    
    const userId = `user:${email}`;
    
    // Check if user already exists
    const existingUser = await env.TRAVEL_KV.get(`user:${userId}`);
    if (existingUser) {
      return jsonResponse({ error: 'Account already exists. Please login.' }, 409);
    }
    
    // Hash password
    const hashedPassword = await hashPassword(password);
    
    // Create user
    const user = {
      id: userId,
      email,
      password: hashedPassword,
      createdAt: Date.now()
    };
    
    await env.TRAVEL_KV.put(`user:${userId}`, JSON.stringify(user));
    
    // Generate tokens
    const accessToken = await createJWT(userId, email, 'access');
    const refreshToken = await createJWT(userId, email, 'refresh');
    
    // Store session
    const sessionId = crypto.randomUUID();
    await env.TRAVEL_KV.put(
      `session:${userId}:${sessionId}`,
      JSON.stringify({
        refreshToken,
        createdAt: Date.now(),
        lastUsed: Date.now()
      }),
      { expirationTtl: REFRESH_TOKEN_EXPIRY }
    );
    
    return jsonResponse({
      success: true,
      accessToken,
      refreshToken,
      userId,
      email,
      expiresIn: ACCESS_TOKEN_EXPIRY
    });
  } catch (error) {
    console.error('Signup error:', error);
    return jsonResponse({ error: 'Failed to create account' }, 500);
  }
}

async function login(request, env) {
  try {
    const { email, password } = await request.json();
    
    if (!email || !password) {
      return jsonResponse({ error: 'Email and password required' }, 400);
    }
    
    const userId = `user:${email}`;
    
    // Get user
    const userData = await env.TRAVEL_KV.get(userId);
    
    if (!userData) {
      return jsonResponse({ error: 'Invalid email or password' }, 401);
    }
    
    const user = JSON.parse(userData);
    
    // Verify password
    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      console.error('Login: Invalid password for email:', email);
      return jsonResponse({ error: 'Invalid email or password' }, 401);
    }
    
    // Generate tokens
    const accessToken = await createJWT(userId, email, 'access');
    const refreshToken = await createJWT(userId, email, 'refresh');
    
    // Store session
    const sessionId = crypto.randomUUID();
    await env.TRAVEL_KV.put(
      `session:${userId}:${sessionId}`,
      JSON.stringify({
        refreshToken,
        createdAt: Date.now(),
        lastUsed: Date.now()
      }),
      { expirationTtl: REFRESH_TOKEN_EXPIRY }
    );
    
    return jsonResponse({
      success: true,
      accessToken,
      refreshToken,
      userId,
      email,
      expiresIn: ACCESS_TOKEN_EXPIRY
    });
  } catch (error) {
    console.error('Login error:', error);
    console.error('Login error stack:', error.stack);
    return jsonResponse({ 
      error: 'Failed to login',
      details: error.message 
    }, 500);
  }
}

// ==================== COLLABORATION FUNCTIONS ====================

async function generateInviteLink(userId, tripId, env) {
  try {
    console.log('generateInviteLink called with:', { userId, tripId });
    
    // Get the trip
    const tripData = await env.TRAVEL_KV.get(`trip:${userId}:${tripId}`);
    
    console.log('Trip data found:', tripData ? 'yes' : 'no');
    
    if (!tripData) {
      console.log('Trip not found with key:', `trip:${userId}:${tripId}`);
      return jsonResponse({ error: 'Trip not found or you do not have permission' }, 404);
    }
    
    const trip = JSON.parse(tripData);
    console.log('Trip userId:', trip.userId, 'Request userId:', userId);
    
    // Check if user is the owner
    if (trip.userId !== userId) {
      return jsonResponse({ error: 'Only the trip owner can generate invite links' }, 403);
    }
    
    // Generate invite token
    const inviteToken = crypto.randomUUID();
    const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
    
    // Store invite data in KV
    await env.TRAVEL_KV.put(
      `invite:${inviteToken}`,
      JSON.stringify({
        tripId,
        ownerId: userId,
        tripTitle: trip.title,
        createdAt: Date.now(),
        expiresAt
      }),
      { expirationTtl: 7 * 24 * 60 * 60 } // 7 days
    );
    
    return jsonResponse({
      success: true,
      inviteToken,
      expiresAt
    });
  } catch (error) {
    console.error('Generate invite link error:', error);
    return jsonResponse({ error: 'Failed to generate invite link: ' + error.message }, 500);
  }
}

async function acceptInvite(request, env) {
  try {
    const { inviteToken, userId } = await request.json();
    
    if (!inviteToken || !userId) {
      return jsonResponse({ error: 'Invite token and user ID required' }, 400);
    }
    
    // Get invite data
    const inviteData = await env.TRAVEL_KV.get(`invite:${inviteToken}`);
    
    if (!inviteData) {
      return jsonResponse({ error: 'Invalid or expired invite link' }, 404);
    }
    
    const invite = JSON.parse(inviteData);
    
    // Check if expired
    if (Date.now() > invite.expiresAt) {
      await env.TRAVEL_KV.delete(`invite:${inviteToken}`);
      return jsonResponse({ error: 'This invite link has expired' }, 410);
    }
    
    // Get the trip
    const tripData = await env.TRAVEL_KV.get(`trip:${invite.ownerId}:${invite.tripId}`);
    
    if (!tripData) {
      return jsonResponse({ error: 'Trip not found' }, 404);
    }
    
    const trip = JSON.parse(tripData);
    
    // Get user email from userId
    const userData = await env.TRAVEL_KV.get(`user:${userId}`);
    if (!userData) {
      return jsonResponse({ error: 'User not found' }, 404);
    }
    
    const user = JSON.parse(userData);
    const email = user.email;
    
    // Check if already a collaborator
    if (trip.collaborators && trip.collaborators.some(c => c.email === email)) {
      return jsonResponse({ 
        success: true, 
        message: 'You already have access to this trip',
        tripId: invite.tripId
      });
    }
    
    // Add to trip's collaborators array
    if (!trip.collaborators) {
      trip.collaborators = [];
    }
    
    trip.collaborators.push({
      userId,
      email,
      addedAt: Date.now(),
      addedVia: 'invite-link'
    });
    
    trip.updatedAt = Date.now();
    
    // Save updated trip
    await env.TRAVEL_KV.put(`trip:${invite.ownerId}:${invite.tripId}`, JSON.stringify(trip));
    
    // Add to collaborator's trip list
    const collaboratorTripsList = await env.TRAVEL_KV.get(`collaborator-trips:${userId}`);
    const collaboratorTrips = collaboratorTripsList ? JSON.parse(collaboratorTripsList) : [];
    
    if (!collaboratorTrips.some(ref => ref.tripId === invite.tripId && ref.ownerId === invite.ownerId)) {
      collaboratorTrips.push({
        tripId: invite.tripId,
        ownerId: invite.ownerId,
        addedAt: Date.now()
      });
      
      await env.TRAVEL_KV.put(`collaborator-trips:${userId}`, JSON.stringify(collaboratorTrips));
    }
    
    // Delete the invite token (one-time use)
    await env.TRAVEL_KV.delete(`invite:${inviteToken}`);
    
    return jsonResponse({
      success: true,
      message: `You've been added to "${invite.tripTitle}"!`,
      tripId: invite.tripId,
      tripTitle: invite.tripTitle
    });
  } catch (error) {
    console.error('Accept invite error:', error);
    return jsonResponse({ error: 'Failed to accept invite: ' + error.message }, 500);
  }
}

async function addCollaborator(userId, tripId, request, env) {
  try {
    const { email } = await request.json();
    
    if (!email || !email.includes('@')) {
      return jsonResponse({ error: 'Valid email required' }, 400);
    }
    
    // Get the trip - need to find it by checking if user owns it
    const tripData = await env.TRAVEL_KV.get(`trip:${userId}:${tripId}`);
    
    if (!tripData) {
      return jsonResponse({ error: 'Trip not found or you do not have permission' }, 404);
    }
    
    const trip = JSON.parse(tripData);
    
    // Check if user is the owner
    if (trip.userId !== userId) {
      return jsonResponse({ error: 'Only the trip owner can add collaborators' }, 403);
    }
    
    // Create collaborator userId from email
    const collaboratorUserId = `user:${email}`;
    
    // Check if the user account exists
    const collaboratorUserData = await env.TRAVEL_KV.get(`user:${collaboratorUserId}`);
    if (!collaboratorUserData) {
      return jsonResponse({ error: 'This email doesn\'t have an account. Ask them to sign up first, or use an invite link to share the trip.' }, 404);
    }
    
    // Check if already a collaborator
    if (trip.collaborators && trip.collaborators.some(c => c.email === email)) {
      return jsonResponse({ error: 'User is already a collaborator' }, 400);
    }
    
    // Add to trip's collaborators array
    if (!trip.collaborators) {
      trip.collaborators = [];
    }
    
    trip.collaborators.push({
      userId: collaboratorUserId,
      email,
      addedAt: Date.now()
    });
    
    trip.updatedAt = Date.now();
    
    // Save updated trip
    await env.TRAVEL_KV.put(`trip:${userId}:${tripId}`, JSON.stringify(trip));
    
    // Add to collaborator's trip list
    const collaboratorTripsList = await env.TRAVEL_KV.get(`collaborator-trips:${collaboratorUserId}`);
    const collaboratorTrips = collaboratorTripsList ? JSON.parse(collaboratorTripsList) : [];
    
    if (!collaboratorTrips.some(ref => ref.tripId === tripId && ref.ownerId === userId)) {
      collaboratorTrips.push({
        tripId,
        ownerId: userId,
        addedAt: Date.now()
      });
      
      await env.TRAVEL_KV.put(`collaborator-trips:${collaboratorUserId}`, JSON.stringify(collaboratorTrips));
    }
    
    return jsonResponse({ 
      success: true, 
      message: `${email} added as collaborator`,
      collaborators: trip.collaborators
    });
  } catch (error) {
    console.error('Add collaborator error:', error);
    return jsonResponse({ error: 'Failed to add collaborator: ' + error.message }, 500);
  }
}

async function removeCollaborator(userId, tripId, collaboratorEmail, env) {
  try {
    // Get the trip
    const tripData = await env.TRAVEL_KV.get(`trip:${userId}:${tripId}`);
    
    if (!tripData) {
      return jsonResponse({ error: 'Trip not found or you do not have permission' }, 404);
    }
    
    const trip = JSON.parse(tripData);
    
    // Check if user is the owner
    if (trip.userId !== userId) {
      return jsonResponse({ error: 'Only the trip owner can remove collaborators' }, 403);
    }
    
    // Remove from trip's collaborators array
    const collaboratorToRemove = trip.collaborators?.find(c => c.email === collaboratorEmail);
    
    if (!collaboratorToRemove) {
      return jsonResponse({ error: 'Collaborator not found' }, 404);
    }
    
    trip.collaborators = trip.collaborators.filter(c => c.email !== collaboratorEmail);
    trip.updatedAt = Date.now();
    
    // Save updated trip
    await env.TRAVEL_KV.put(`trip:${userId}:${tripId}`, JSON.stringify(trip));
    
    // Remove from collaborator's trip list
    const collaboratorUserId = collaboratorToRemove.userId;
    const collaboratorTripsList = await env.TRAVEL_KV.get(`collaborator-trips:${collaboratorUserId}`);
    
    if (collaboratorTripsList) {
      const collaboratorTrips = JSON.parse(collaboratorTripsList);
      const updatedCollaboratorTrips = collaboratorTrips.filter(
        ref => !(ref.tripId === tripId && ref.ownerId === userId)
      );
      
      await env.TRAVEL_KV.put(`collaborator-trips:${collaboratorUserId}`, JSON.stringify(updatedCollaboratorTrips));
    }
    
    return jsonResponse({ 
      success: true, 
      message: `${collaboratorEmail} removed from trip`,
      collaborators: trip.collaborators
    });
  } catch (error) {
    console.error('Remove collaborator error:', error);
    return jsonResponse({ error: 'Failed to remove collaborator: ' + error.message }, 500);
  }
}

// ==================== TRIP FUNCTIONS ====================

async function getTrips(userId, env) {
  // Get user's own trips
  const tripsList = await env.TRAVEL_KV.get(`trips:${userId}`);
  const ownTripIds = tripsList ? JSON.parse(tripsList) : [];
  
  // Get trips owned by user
  const ownTrips = await Promise.all(
    ownTripIds.map(async (tripId) => {
      const tripData = await env.TRAVEL_KV.get(`trip:${userId}:${tripId}`);
      if (tripData) {
        const trip = JSON.parse(tripData);
        trip.role = 'owner';
        return trip;
      }
      return null;
    })
  );
  
  // Get trips where user is a collaborator
  const collaboratorTripsList = await env.TRAVEL_KV.get(`collaborator-trips:${userId}`);
  const collaboratorTripRefs = collaboratorTripsList ? JSON.parse(collaboratorTripsList) : [];
  
  const collaboratorTrips = await Promise.all(
    collaboratorTripRefs.map(async (ref) => {
      const tripData = await env.TRAVEL_KV.get(`trip:${ref.ownerId}:${ref.tripId}`);
      if (tripData) {
        const trip = JSON.parse(tripData);
        trip.role = 'collaborator';
        return trip;
      }
      return null;
    })
  );
  
  const allTrips = [...ownTrips, ...collaboratorTrips].filter(Boolean);
  
  return jsonResponse({ trips: allTrips });
}

async function createTrip(userId, request, env) {
  const tripData = await request.json();
  const tripId = crypto.randomUUID();
  
  const newTrip = {
    id: tripId,
    userId,
    ownerEmail: '', // Will be populated from user data
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...tripData,
    days: tripData.days || [],
    accommodations: tripData.accommodations || [],
    travel: tripData.travel || [],
    packingList: tripData.packingList || [],
    notes: tripData.notes || [],
    collaborators: [] // Array of {userId, email, addedAt}
  };

  await env.TRAVEL_KV.put(`trip:${userId}:${tripId}`, JSON.stringify(newTrip));
  
  // Add to user's trip list
  const tripsList = await env.TRAVEL_KV.get(`trips:${userId}`);
  const trips = tripsList ? JSON.parse(tripsList) : [];
  trips.push(tripId);
  await env.TRAVEL_KV.put(`trips:${userId}`, JSON.stringify(trips));

  // Set role to owner for the response
  newTrip.role = 'owner';

  return jsonResponse({ success: true, trip: newTrip });
}

async function getTrip(userId, tripId, env) {
  const tripData = await env.TRAVEL_KV.get(`trip:${userId}:${tripId}`);
  
  if (!tripData) {
    return jsonResponse({ error: 'Trip not found' }, 404);
  }

  const trip = JSON.parse(tripData);
  return jsonResponse({ trip });
}

async function updateTrip(userId, tripId, request, env) {
  const tripData = await env.TRAVEL_KV.get(`trip:${userId}:${tripId}`);
  
  if (!tripData) {
    return jsonResponse({ error: 'Trip not found' }, 404);
  }

  const existingTrip = JSON.parse(tripData);
  const updates = await request.json();
  
  const updatedTrip = {
    ...existingTrip,
    ...updates,
    id: tripId,
    userId: existingTrip.userId,
    updatedAt: Date.now()
  };

  await env.TRAVEL_KV.put(`trip:${userId}:${tripId}`, JSON.stringify(updatedTrip));
  
  // Set role to owner since this is the user's own trip
  updatedTrip.role = 'owner';
  
  return jsonResponse({ success: true, trip: updatedTrip });
}

async function deleteTrip(userId, tripId, env) {
  // Get trip data to find photos to delete
  const tripData = await env.TRAVEL_KV.get(`trip:${userId}:${tripId}`);
  if (tripData) {
    const trip = JSON.parse(tripData);
    // Delete all photos from R2 if they exist
    if (trip.memories?.photos) {
      for (const photo of trip.memories.photos) {
        try {
          await env.PHOTOS.delete(photo.key);
        } catch (e) {
          console.error('Error deleting photo:', e);
        }
      }
    }
  }
  
  await env.TRAVEL_KV.delete(`trip:${userId}:${tripId}`);
  
  // Remove from trip list
  const tripsList = await env.TRAVEL_KV.get(`trips:${userId}`);
  if (tripsList) {
    const trips = JSON.parse(tripsList).filter(id => id !== tripId);
    await env.TRAVEL_KV.put(`trips:${userId}`, JSON.stringify(trips));
  }
  
  return jsonResponse({ success: true });
}

async function uploadPhoto(userId, tripId, request, env) {
  try {
    const formData = await request.formData();
    const file = formData.get('photo');
    const caption = formData.get('caption') || '';
    
    if (!file) {
      return jsonResponse({ error: 'No file provided' }, 400);
    }
    
    // Generate unique key for the photo
    const photoId = crypto.randomUUID();
    const extension = file.name.split('.').pop();
    const key = `${userId}/${tripId}/${photoId}.${extension}`;
    
    // Upload to R2
    await env.PHOTOS.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
    });
    
    // Get trip data
    const tripData = await env.TRAVEL_KV.get(`trip:${userId}:${tripId}`);
    if (!tripData) {
      return jsonResponse({ error: 'Trip not found' }, 404);
    }
    
    const trip = JSON.parse(tripData);
    
    // Initialize memories if it doesn't exist
    if (!trip.memories) {
      trip.memories = {
        photos: [],
        highlights: ''
      };
    }
    
    // Add photo metadata
    const photoData = {
      id: photoId,
      key: key,
      caption: caption,
      uploadedAt: Date.now(),
      filename: file.name,
      contentType: file.type
    };
    
    trip.memories.photos = [...(trip.memories.photos || []), photoData];
    trip.updatedAt = Date.now();
    
    // Save updated trip
    await env.TRAVEL_KV.put(`trip:${userId}:${tripId}`, JSON.stringify(trip));
    
    return jsonResponse({ success: true, photo: photoData });
  } catch (error) {
    console.error('Upload error:', error);
    return jsonResponse({ error: 'Upload failed: ' + error.message }, 500);
  }
}

async function deletePhoto(userId, tripId, photoId, env) {
  try {
    // Get trip data
    const tripData = await env.TRAVEL_KV.get(`trip:${userId}:${tripId}`);
    if (!tripData) {
      return jsonResponse({ error: 'Trip not found' }, 404);
    }
    
    const trip = JSON.parse(tripData);
    
    if (!trip.memories?.photos) {
      return jsonResponse({ error: 'No photos found' }, 404);
    }
    
    // Find the photo
    const photo = trip.memories.photos.find(p => p.id === photoId);
    if (!photo) {
      return jsonResponse({ error: 'Photo not found' }, 404);
    }
    
    // Delete from R2
    await env.PHOTOS.delete(photo.key);
    
    // Remove from trip data
    trip.memories.photos = trip.memories.photos.filter(p => p.id !== photoId);
    trip.updatedAt = Date.now();
    
    // Save updated trip
    await env.TRAVEL_KV.put(`trip:${userId}:${tripId}`, JSON.stringify(trip));
    
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    return jsonResponse({ error: 'Delete failed: ' + error.message }, 500);
  }
}

async function servePhoto(key, env) {
  try {
    const object = await env.PHOTOS.get(key);
    
    if (!object) {
      return new Response('Photo not found', { status: 404 });
    }
    
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000');
    headers.append('Access-Control-Allow-Origin', '*');
    
    return new Response(object.body, {
      headers,
    });
  } catch (error) {
    console.error('Serve photo error:', error);
    return new Response('Error serving photo', { status: 500 });
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}

// ==================== TRAVEL GUIDE FUNCTIONS ====================

async function createGuide(userId, tripId, request, env) {
  try {
    // Get the trip
    const tripData = await env.TRAVEL_KV.get(`trip:${userId}:${tripId}`);
    
    if (!tripData) {
      return jsonResponse({ error: 'Trip not found' }, 404);
    }
    
    const trip = JSON.parse(tripData);
    
    // Check if user is the owner
    if (trip.userId !== userId) {
      return jsonResponse({ error: 'Only the trip owner can create a guide' }, 403);
    }
    
    const guideData = await request.json();
    const guideId = crypto.randomUUID();
    
    // Create guide object
    const guide = {
      id: guideId,
      tripId,
      userId,
      title: guideData.title || trip.title,
      description: guideData.description || '',
      destination: guideData.destination || trip.destination,
      destinations: guideData.destinations || trip.destinations || [],
      startDate: trip.startDate,
      endDate: trip.endDate,
      coverPhoto: guideData.coverPhoto || null,
      
      // Curated content (selected by user)
      days: guideData.days || [], // Array of selected day objects
      highlights: guideData.highlights || [],
      tips: guideData.tips || [],
      
      // Metadata
      isPublic: guideData.isPublic !== false, // Default to public
      views: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      
      // Author info
      authorName: guideData.authorName || '',
      authorBio: guideData.authorBio || ''
    };
    
    // Store guide
    await env.TRAVEL_KV.put(`guide:${guideId}`, JSON.stringify(guide));
    
    // Link guide to trip
    await env.TRAVEL_KV.put(`trip-guide:${userId}:${tripId}`, guideId);
    
    // Add to user's guides list
    const guidesList = await env.TRAVEL_KV.get(`guides:${userId}`);
    const guides = guidesList ? JSON.parse(guidesList) : [];
    guides.push(guideId);
    await env.TRAVEL_KV.put(`guides:${userId}`, JSON.stringify(guides));
    
    return jsonResponse({ success: true, guide });
  } catch (error) {
    console.error('Create guide error:', error);
    return jsonResponse({ error: 'Failed to create guide: ' + error.message }, 500);
  }
}

async function getGuideByTrip(userId, tripId, env) {
  try {
    // Get guide ID for this trip
    const guideId = await env.TRAVEL_KV.get(`trip-guide:${userId}:${tripId}`);
    
    if (!guideId) {
      return jsonResponse({ guide: null });
    }
    
    // Get guide data
    const guideData = await env.TRAVEL_KV.get(`guide:${guideId}`);
    
    if (!guideData) {
      return jsonResponse({ guide: null });
    }
    
    const guide = JSON.parse(guideData);
    return jsonResponse({ guide });
  } catch (error) {
    console.error('Get guide by trip error:', error);
    return jsonResponse({ error: 'Failed to get guide: ' + error.message }, 500);
  }
}

async function getPublicGuide(guideId, env) {
  try {
    const guideData = await env.TRAVEL_KV.get(`guide:${guideId}`);
    
    if (!guideData) {
      return jsonResponse({ error: 'Guide not found' }, 404);
    }
    
    const guide = JSON.parse(guideData);
    
    // Check if guide is public
    if (!guide.isPublic) {
      return jsonResponse({ error: 'This guide is private' }, 403);
    }
    
    // Increment view count
    guide.views = (guide.views || 0) + 1;
    await env.TRAVEL_KV.put(`guide:${guideId}`, JSON.stringify(guide));
    
    return jsonResponse({ guide });
  } catch (error) {
    console.error('Get public guide error:', error);
    return jsonResponse({ error: 'Failed to get guide: ' + error.message }, 500);
  }
}

async function updateGuide(userId, tripId, request, env) {
  try {
    // Get guide ID for this trip
    const guideId = await env.TRAVEL_KV.get(`trip-guide:${userId}:${tripId}`);
    
    if (!guideId) {
      return jsonResponse({ error: 'Guide not found' }, 404);
    }
    
    // Get existing guide
    const guideData = await env.TRAVEL_KV.get(`guide:${guideId}`);
    
    if (!guideData) {
      return jsonResponse({ error: 'Guide not found' }, 404);
    }
    
    const existingGuide = JSON.parse(guideData);
    
    // Check ownership
    if (existingGuide.userId !== userId) {
      return jsonResponse({ error: 'Only the guide owner can update it' }, 403);
    }
    
    const updates = await request.json();
    
    const updatedGuide = {
      ...existingGuide,
      ...updates,
      id: guideId,
      tripId,
      userId,
      updatedAt: Date.now()
    };
    
    await env.TRAVEL_KV.put(`guide:${guideId}`, JSON.stringify(updatedGuide));
    
    return jsonResponse({ success: true, guide: updatedGuide });
  } catch (error) {
    console.error('Update guide error:', error);
    return jsonResponse({ error: 'Failed to update guide: ' + error.message }, 500);
  }
}

async function deleteGuide(userId, tripId, env) {
  try {
    // Get guide ID for this trip
    const guideId = await env.TRAVEL_KV.get(`trip-guide:${userId}:${tripId}`);
    
    if (!guideId) {
      return jsonResponse({ error: 'Guide not found' }, 404);
    }
    
    // Get guide to verify ownership
    const guideData = await env.TRAVEL_KV.get(`guide:${guideId}`);
    
    if (guideData) {
      const guide = JSON.parse(guideData);
      
      if (guide.userId !== userId) {
        return jsonResponse({ error: 'Only the guide owner can delete it' }, 403);
      }
    }
    
    // Delete guide
    await env.TRAVEL_KV.delete(`guide:${guideId}`);
    
    // Delete trip-guide link
    await env.TRAVEL_KV.delete(`trip-guide:${userId}:${tripId}`);
    
    // Remove from user's guides list
    const guidesList = await env.TRAVEL_KV.get(`guides:${userId}`);
    if (guidesList) {
      const guides = JSON.parse(guidesList).filter(id => id !== guideId);
      await env.TRAVEL_KV.put(`guides:${userId}`, JSON.stringify(guides));
    }
    
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Delete guide error:', error);
    return jsonResponse({ error: 'Failed to delete guide: ' + error.message }, 500);
  }
}
