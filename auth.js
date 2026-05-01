// Amplify Gen 2 Authentication Handler
// This file handles login, signup, and session management

import { Amplify } from 'aws-amplify';
import { signIn, signUp, signOut, getCurrentUser } from 'aws-amplify/auth';
import amplifyconfig from './amplifyconfiguration.json';

// Configure Amplify
Amplify.configure(amplifyconfig);

class CognitoAuth {
  constructor() {
    this.initialized = true;
  }

  async login(email, password) {
    try {
      const { isSignedIn } = await signIn({
        username: email,
        password: password,
      });

      if (isSignedIn) {
        localStorage.setItem('userEmail', email);
        return { success: true, user: email };
      } else {
        throw new Error('Login failed - user not signed in');
      }
    } catch (error) {
      throw new Error(error.message || 'Login failed');
    }
  }

  async signup(email, password) {
    try {
      const { userId } = await signUp({
        username: email,
        password: password,
        options: {
          userAttributes: {
            email: email,
          },
        },
      });

      return { success: true, userSub: userId };
    } catch (error) {
      throw new Error(error.message || 'Signup failed');
    }
  }

  async getCurrentUser() {
    try {
      return await getCurrentUser();
    } catch {
      return null;
    }
  }

  async logout() {
    try {
      await signOut();
      localStorage.removeItem('userEmail');
    } catch (error) {
      console.error('Logout error:', error);
    }
  }

  async isLoggedIn() {
    try {
      await getCurrentUser();
      return true;
    } catch {
      return false;
    }
  }
}

// Initialize Cognito Auth
const auth = new CognitoAuth();

// Tab switching
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    const tabName = e.target.dataset.tab;
    
    // Update active tab
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    
    // Update active form
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById(tabName === 'login' ? 'loginForm' : 'signupForm').classList.add('active');
    
    // Clear messages
    clearMessage();
  });
});

// Helper functions
function showMessage(text, type) {
  const messageEl = document.getElementById('authMessage');
  messageEl.textContent = text;
  messageEl.className = `auth-message show ${type}`;
}

function clearMessage() {
  const messageEl = document.getElementById('authMessage');
  messageEl.className = 'auth-message';
}

function showError(fieldId, message) {
  const errorEl = document.getElementById(fieldId);
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.add('show');
  }
}

function clearErrors() {
  document.querySelectorAll('.form-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('show');
  });
}

// Login Form Handler
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();
  clearMessage();

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');

  // Validation
  if (!email) {
    showError('loginEmailError', 'Email is required');
    return;
  }
  if (!password) {
    showError('loginPasswordError', 'Password is required');
    return;
  }

  // Disable button and show loading
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.innerHTML = '<span class="loading"></span>';

  try {
    const result = await auth.login(email, password);
    showMessage('Login successful! Redirecting...', 'success');
    
    setTimeout(() => {
      window.location.href = '/index.html';
    }, 1500);
  } catch (error) {
    showMessage(error.message, 'error');
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// Signup Form Handler
document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();
  clearMessage();

  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirmPassword = document.getElementById('signupConfirmPassword').value;
  const btn = document.getElementById('signupBtn');

  // Validation
  if (!email) {
    showError('signupEmailError', 'Email is required');
    return;
  }
  if (!password) {
    showError('signupPasswordError', 'Password is required');
    return;
  }
  if (password.length < 8) {
    showError('signupPasswordError', 'Password must be at least 8 characters');
    return;
  }
  if (password !== confirmPassword) {
    showError('signupConfirmError', 'Passwords do not match');
    return;
  }

  // Disable button and show loading
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.innerHTML = '<span class="loading"></span>';

  try {
    const result = await auth.signup(email, password);
    showMessage('Account created! Check your email for verification.', 'success');
    document.getElementById('signupForm').reset();
    
    setTimeout(() => {
      // Switch to login tab
      document.querySelector('[data-tab="login"]').click();
      document.getElementById('loginEmail').value = email;
    }, 2000);
  } catch (error) {
    showMessage(error.message, 'error');
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// Auto-redirect if already logged in
window.addEventListener('load', async () => {
  const isLoggedIn = await auth.isLoggedIn();
  if (isLoggedIn) {
    window.location.href = '/index.html';
  }
});
