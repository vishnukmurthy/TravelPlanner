// Script to manually set password for vmurthy@berkeley.edu
// Run with: wrangler dev --local set-password.js

export default {
  async fetch(request, env) {
    const email = 'vmurthy@berkeley.edu';
    const password = 'Aztereje6!';
    const userId = `user:${email}`;
    
    // Hash password using SHA-256
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashedPassword = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Try to get user with different key formats
    let userData = await env.TRAVEL_KV.get(`user:${userId}`);
    let userKey = `user:${userId}`;
    
    if (!userData) {
      userData = await env.TRAVEL_KV.get(userId);
      userKey = userId;
    }
    
    if (!userData) {
      return new Response(JSON.stringify({ 
        error: 'User not found',
        triedKeys: [`user:${userId}`, userId]
      }), { 
        headers: { 'Content-Type': 'application/json' },
        status: 404
      });
    }
    
    const user = JSON.parse(userData);
    
    // Update user with password
    user.password = hashedPassword;
    user.passwordSetAt = Date.now();
    
    await env.TRAVEL_KV.put(userKey, JSON.stringify(user));
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Password set successfully!',
      email: email,
      userKey: userKey,
      hashedPassword: hashedPassword
    }), { 
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
