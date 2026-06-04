// Amplify Gen 2 Authentication Handler
// This file is loaded directly in the browser, so it uses CDN ESM imports.

import { Amplify } from 'https://esm.sh/@aws-amplify/core@6.16.2';
import {
  confirmSignUp,
  cognitoCredentialsProvider,
  cognitoUserPoolsTokenProvider,
  getCurrentUser,
  resendSignUpCode,
  signIn,
  signOut,
  signUp,
} from 'https://esm.sh/@aws-amplify/auth@6.19.1/cognito?deps=@aws-amplify/core@6.16.2';

const CONFIG_PATHS = ['/amplify_outputs.json', '/amplifyconfiguration.json'];

let authReady = false;
let pendingEmail = '';
let cognitoApiConfig = null;

window.summitAuthModuleLoaded = true;

const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const confirmForm = document.getElementById('confirmForm');
const forgotForm = document.getElementById('forgotForm');
const resetForm = document.getElementById('resetForm');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const confirmBtn = document.getElementById('confirmBtn');
const forgotBtn = document.getElementById('forgotBtn');
const resetBtn = document.getElementById('resetBtn');
const resendCodeBtn = document.getElementById('resendCodeBtn');

async function loadAmplifyConfig() {
  for (const path of CONFIG_PATHS) {
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (response.ok) return normalizeAmplifyConfig(await response.json());
    } catch {
      // Try the next known Amplify config filename.
    }
  }

  throw new Error('Missing Amplify config. Run `npx ampx sandbox` locally or deploy/generate outputs in Amplify.');
}

function normalizeAmplifyConfig(config) {
  if (config.Auth?.Cognito?.userPoolId && config.Auth?.Cognito?.userPoolClientId) {
    return config;
  }

  if (config.auth) {
    const auth = config.auth;
    return {
      ...config,
      Auth: {
        Cognito: {
          userPoolId: auth.user_pool_id,
          userPoolClientId: auth.user_pool_client_id,
          identityPoolId: auth.identity_pool_id,
          allowGuestAccess: auth.unauthenticated_identities_enabled,
          groups: auth.groups,
          loginWith: {
            email: auth.username_attributes?.includes('email') ?? true,
            phone: auth.username_attributes?.includes('phone_number') ?? false,
            username: auth.username_attributes?.includes('username') ?? false,
          },
          mfa: auth.mfa_configuration ? {
            status: auth.mfa_configuration === 'OPTIONAL' ? 'optional' : auth.mfa_configuration === 'REQUIRED' ? 'on' : 'off',
            smsEnabled: auth.mfa_methods?.includes('SMS') ?? false,
            totpEnabled: auth.mfa_methods?.includes('TOTP') ?? false,
          } : undefined,
          passwordFormat: auth.password_policy ? {
            minLength: auth.password_policy.min_length ?? 8,
            requireLowercase: auth.password_policy.require_lowercase ?? false,
            requireNumbers: auth.password_policy.require_numbers ?? false,
            requireSpecialCharacters: auth.password_policy.require_symbols ?? false,
            requireUppercase: auth.password_policy.require_uppercase ?? false,
          } : undefined,
          signUpVerificationMethod: 'code',
          userAttributes: auth.standard_required_attributes?.reduce((attributes, name) => {
            attributes[name] = { required: true };
            return attributes;
          }, {}),
        },
      },
    };
  }

  if (config.aws_user_pools_id && config.aws_user_pools_web_client_id) {
    return {
      ...config,
      Auth: {
        Cognito: {
          userPoolId: config.aws_user_pools_id,
          userPoolClientId: config.aws_user_pools_web_client_id,
          identityPoolId: config.aws_cognito_identity_pool_id,
          loginWith: {
            email: config.aws_cognito_username_attributes?.includes('EMAIL') ?? true,
            phone: config.aws_cognito_username_attributes?.includes('PHONE_NUMBER') ?? false,
            username: !(config.aws_cognito_username_attributes?.includes('EMAIL') || config.aws_cognito_username_attributes?.includes('PHONE_NUMBER')),
          },
          signUpVerificationMethod: config.aws_cognito_sign_up_verification_method || 'code',
        },
      },
    };
  }

  return config;
}

function setButtonsDisabled(disabled) {
  [loginBtn, signupBtn, confirmBtn, forgotBtn, resetBtn, resendCodeBtn].forEach(btn => {
    if (btn) btn.disabled = disabled;
  });
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = '<span class="loading"></span>';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
  }
}

function showMessage(text, type) {
  const messageEl = document.getElementById('authMessage');
  messageEl.textContent = text;
  messageEl.className = `auth-message show ${type}`;
}

function clearMessage() {
  const messageEl = document.getElementById('authMessage');
  messageEl.className = 'auth-message';
  messageEl.textContent = '';
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

function setActiveForm(formName) {
  document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
  document.querySelectorAll('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === formName));

  const formMap = {
    login: loginForm,
    signup: signupForm,
    confirm: confirmForm,
    forgot: forgotForm,
    reset: resetForm,
  };

  formMap[formName]?.classList.add('active');
}

function getFriendlyError(error) {
  const message = error?.message || 'Something went wrong. Please try again.';
  if (message.includes('UserAlreadyAuthenticatedException')) return 'You are already signed in. Redirecting...';
  if (message.includes('UserNotConfirmedException')) return 'Please confirm your email with the code Cognito sent you.';
  if (message.includes('UsernameExistsException')) return 'An account with that email already exists. Try signing in.';
  if (message.includes('NotAuthorizedException')) return 'Incorrect email or password.';
  if (message.includes('InvalidPasswordException')) return 'Password must meet the Cognito policy: uppercase, lowercase, number, and symbol.';
  if (message.includes('CodeMismatchException')) return 'That confirmation code is not correct.';
  if (message.includes('ExpiredCodeException')) return 'That confirmation code expired. Send a new code and try again.';
  if (message.includes('UserNotFoundException')) return 'No account exists for that email.';
  if (message.includes('LimitExceededException')) return 'Too many attempts. Wait a few minutes and try again.';
  return message;
}

async function redirectIfSignedIn() {
  try {
    await getCurrentUser();
    window.location.href = '/marketplace.html';
  } catch {
    // No active session, stay on auth page.
  }
}

async function configureAuth() {
  setButtonsDisabled(true);
  try {
    const config = await loadAmplifyConfig();
    cognitoApiConfig = getCognitoApiConfig(config);
    configureAmplifyAuth(config);
    authReady = true;
    setButtonsDisabled(false);
    await redirectIfSignedIn();
  } catch (error) {
    setButtonsDisabled(false);
    showMessage(getFriendlyError(error), 'error');
  }
}

function configureAmplifyAuth(config) {
  cognitoUserPoolsTokenProvider.setAuthConfig(config.Auth);
  Amplify.configure(config, {
    Auth: {
      tokenProvider: cognitoUserPoolsTokenProvider,
      credentialsProvider: cognitoCredentialsProvider,
    },
  });
}

function getCognitoApiConfig(config) {
  const auth = config.auth || config.Auth?.Cognito || {};
  const region =
    auth.aws_region ||
    auth.region ||
    config.aws_cognito_region ||
    config.aws_project_region ||
    config.region;
  const clientId =
    auth.user_pool_client_id ||
    auth.userPoolClientId ||
    auth.userPoolWebClientId ||
    config.aws_user_pools_web_client_id;
  if (!region || !clientId) {
    throw new Error('Missing Cognito password reset configuration.');
  }
  return { region, clientId };
}

async function cognitoAuthRequest(target, payload) {
  if (!cognitoApiConfig) {
    cognitoApiConfig = getCognitoApiConfig(await loadAmplifyConfig());
  }
  const response = await fetch(`https://cognito-idp.${cognitoApiConfig.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify({ ClientId: cognitoApiConfig.clientId, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.__type || `${target} failed`);
  return data;
}

document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', e => {
    const tabName = e.currentTarget.dataset.tab;
    clearErrors();
    clearMessage();
    setActiveForm(tabName);
  });
});

document.getElementById('forgotPasswordLink')?.addEventListener('click', () => {
  clearErrors();
  clearMessage();
  document.getElementById('forgotEmail').value = document.getElementById('loginEmail').value.trim();
  setActiveForm('forgot');
});

document.getElementById('forgotBackLogin')?.addEventListener('click', () => {
  clearErrors();
  clearMessage();
  setActiveForm('login');
});

document.getElementById('resetBackForgot')?.addEventListener('click', () => {
  clearErrors();
  clearMessage();
  document.getElementById('forgotEmail').value = document.getElementById('resetEmail').value.trim();
  setActiveForm('forgot');
});

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors();
  clearMessage();

  if (!authReady) {
    showMessage('Amplify Auth is not configured yet.', 'error');
    return;
  }

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email) {
    showError('loginEmailError', 'Email is required');
    return;
  }
  if (!password) {
    showError('loginPasswordError', 'Password is required');
    return;
  }

  setButtonLoading(loginBtn, true);
  try {
    const result = await signIn({ username: email, password });

    if (result.isSignedIn) {
      localStorage.setItem('userEmail', email);
      showMessage('Login successful. Redirecting...', 'success');
      window.location.href = '/marketplace.html';
      return;
    }

    if (result.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
      pendingEmail = email;
      document.getElementById('confirmEmail').value = email;
      setActiveForm('confirm');
      showMessage('Check your email for the confirmation code.', 'success');
      return;
    }

    showMessage(`Next step required: ${result.nextStep?.signInStep || 'unknown'}`, 'error');
  } catch (error) {
    if (error?.name === 'UserNotConfirmedException') {
      pendingEmail = email;
      document.getElementById('confirmEmail').value = email;
      setActiveForm('confirm');
    }
    const message = getFriendlyError(error);
    showMessage(message, message.includes('already signed in') ? 'success' : 'error');
    if (message.includes('already signed in')) window.location.href = '/marketplace.html';
  } finally {
    setButtonLoading(loginBtn, false);
  }
});

signupForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors();
  clearMessage();

  if (!authReady) {
    showMessage('Amplify Auth is not configured yet. Check that amplify_outputs.json exists or that the Amplify Hosting backend build completed.', 'error');
    return;
  }

  const email = document.getElementById('signupEmail').value.trim();
  const displayName = document.getElementById('signupDisplayName').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirmPassword = document.getElementById('signupConfirmPassword').value;

  if (!displayName) {
    showError('signupDisplayNameError', 'Display name is required');
    return;
  }
  if (displayName.length < 2) {
    showError('signupDisplayNameError', 'Display name must be at least 2 characters');
    return;
  }
  if (displayName.includes('@')) {
    showError('signupDisplayNameError', 'Display name cannot be an email address');
    return;
  }
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

  setButtonLoading(signupBtn, true);
  try {
    const result = await signUp({
      username: email,
      password,
      options: {
        userAttributes: {
          email,
          name: displayName,
          preferred_username: displayName,
        },
      },
    });

    pendingEmail = email;

    if (result.isSignUpComplete || result.nextStep?.signUpStep === 'DONE') {
      showMessage('Account created. You can sign in now.', 'success');
      setActiveForm('login');
      document.getElementById('loginEmail').value = email;
      signupForm.reset();
      return;
    }

    document.getElementById('confirmEmail').value = email;
    signupForm.reset();
    setActiveForm('confirm');
    showMessage('Account created. Enter the confirmation code from your email.', 'success');
  } catch (error) {
    showMessage(getFriendlyError(error), 'error');
  } finally {
    setButtonLoading(signupBtn, false);
  }
});

confirmForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors();
  clearMessage();

  const email = document.getElementById('confirmEmail').value.trim() || pendingEmail;
  const code = document.getElementById('confirmCode').value.trim();

  if (!email) {
    showError('confirmEmailError', 'Email is required');
    return;
  }
  if (!code) {
    showError('confirmCodeError', 'Confirmation code is required');
    return;
  }

  setButtonLoading(confirmBtn, true);
  try {
    await confirmSignUp({ username: email, confirmationCode: code });
    pendingEmail = '';
    confirmForm.reset();
    document.getElementById('loginEmail').value = email;
    setActiveForm('login');
    showMessage('Email confirmed. You can sign in now.', 'success');
  } catch (error) {
    showMessage(getFriendlyError(error), 'error');
  } finally {
    setButtonLoading(confirmBtn, false);
  }
});

forgotForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors();
  clearMessage();

  if (!authReady) {
    showMessage('Amplify Auth is not configured yet.', 'error');
    return;
  }

  const email = document.getElementById('forgotEmail').value.trim();
  if (!email) {
    showError('forgotEmailError', 'Email is required');
    return;
  }

  setButtonLoading(forgotBtn, true);
  try {
    await cognitoAuthRequest('ForgotPassword', { Username: email });
    pendingEmail = email;
    document.getElementById('resetEmail').value = email;
    forgotForm.reset();
    setActiveForm('reset');
    showMessage('Reset code sent. Check your email and enter the code below.', 'success');
  } catch (error) {
    showMessage(getFriendlyError(error), 'error');
  } finally {
    setButtonLoading(forgotBtn, false);
  }
});

resetForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors();
  clearMessage();

  if (!authReady) {
    showMessage('Amplify Auth is not configured yet.', 'error');
    return;
  }

  const email = document.getElementById('resetEmail').value.trim() || pendingEmail;
  const code = document.getElementById('resetCode').value.trim();
  const password = document.getElementById('resetPassword').value;
  const confirmPassword = document.getElementById('resetConfirmPassword').value;

  if (!email) {
    showError('resetEmailError', 'Email is required');
    return;
  }
  if (!code) {
    showError('resetCodeError', 'Reset code is required');
    return;
  }
  if (!password) {
    showError('resetPasswordError', 'New password is required');
    return;
  }
  if (password.length < 8) {
    showError('resetPasswordError', 'Password must be at least 8 characters');
    return;
  }
  if (password !== confirmPassword) {
    showError('resetConfirmPasswordError', 'Passwords do not match');
    return;
  }

  setButtonLoading(resetBtn, true);
  try {
    await cognitoAuthRequest('ConfirmForgotPassword', {
      Username: email,
      ConfirmationCode: code,
      Password: password,
    });
    pendingEmail = '';
    resetForm.reset();
    document.getElementById('loginEmail').value = email;
    setActiveForm('login');
    showMessage('Password reset. You can sign in now.', 'success');
  } catch (error) {
    showMessage(getFriendlyError(error), 'error');
  } finally {
    setButtonLoading(resetBtn, false);
  }
});

resendCodeBtn.addEventListener('click', async () => {
  clearErrors();
  clearMessage();

  const email = document.getElementById('confirmEmail').value.trim() || pendingEmail;
  if (!email) {
    showError('confirmEmailError', 'Email is required to resend a code');
    return;
  }

  setButtonLoading(resendCodeBtn, true);
  try {
    await resendSignUpCode({ username: email });
    showMessage('A new confirmation code was sent.', 'success');
  } catch (error) {
    showMessage(getFriendlyError(error), 'error');
  } finally {
    setButtonLoading(resendCodeBtn, false);
  }
});

window.summitAuth = {
  signOut,
  getCurrentUser,
};

configureAuth();
