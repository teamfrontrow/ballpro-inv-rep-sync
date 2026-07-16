/**
 * Wholesale Registration Form Handler
 * Submits form data via AJAX to the PHP backend,
 * which creates the customer via the Shopify Admin API.
 */
(function () {
  'use strict';

  const ENDPOINT = 'https://mos.minnesotainteractive.com/webhooks/ballPro/registerCustomer.php';

  const form = document.getElementById('wholesale-register-form');
  if (!form) return;

  const submitBtn = form.querySelector('#register-submit-btn');
  const btnText = submitBtn.querySelector('.btn__text');
  const btnLoader = submitBtn.querySelector('.btn__loader');
  const successMsg = document.getElementById('register-success');
  const successText = successMsg.querySelector('span');
  const successDefaultText = successText ? successText.textContent : '';
  const alreadyRegisteredMsg = document.getElementById('register-already-registered');
  const alreadyRegisteredText = alreadyRegisteredMsg.querySelector('span');
  const alreadyRegisteredDefaultHTML = alreadyRegisteredText ? alreadyRegisteredText.innerHTML : '';
  const errorMsg = document.getElementById('register-error');
  const errorText = document.getElementById('register-error-text');
  const emailInput = form.querySelector('#RegisterForm-email');
  const emailError = document.getElementById('RegisterForm-email-error');
  const customerNameInput = form.querySelector('[name="customer_name"]');
  const companyNameInput = form.querySelector('[name="company_name"]');
  const companyAddressInput = form.querySelector('[name="company_address"]');
  const customerNameError = document.getElementById('RegisterForm-customer_name-error');
  const companyNameError = document.getElementById('RegisterForm-company_name-error');
  const companyAddressError = document.getElementById('RegisterForm-company_address-error');

  // Pre-fill email from ?email= query param when the field is empty
  // (logged-in customers already have their email set readonly via Liquid).
  try {
    const prefillEmail = new URLSearchParams(window.location.search).get('email');
    if (prefillEmail && !emailInput.value) {
      emailInput.value = prefillEmail;
    }
  } catch (e) { /* ignore */ }

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    btnText.style.display = isLoading ? 'none' : '';
    btnLoader.style.display = isLoading ? 'inline-flex' : 'none';
  }

  function showSuccess(customMessage) {
    if (successText) {
      successText.textContent = customMessage || successDefaultText;
    }
    successMsg.style.display = 'flex';
    errorMsg.style.display = 'none';
    alreadyRegisteredMsg.style.display = 'none';
    form.reset();
    // Hide the form fields, keep only the success message
    Array.from(form.children).forEach(function (child) {
      if (child.id !== 'register-success' && child.id !== 'register-error') {
        child.style.display = 'none';
      }
    });
    successMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showInfo(html) {
    if (alreadyRegisteredText) {
      alreadyRegisteredText.innerHTML = html || alreadyRegisteredDefaultHTML;
    }
    alreadyRegisteredMsg.style.display = 'flex';
    successMsg.style.display = 'none';
    errorMsg.style.display = 'none';
    alreadyRegisteredMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showError(message) {
    errorText.textContent = message || 'Something went wrong. Please try again.';
    errorMsg.style.display = 'flex';
    successMsg.style.display = 'none';
    errorMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideMessages() {
    successMsg.style.display = 'none';
    alreadyRegisteredMsg.style.display = 'none';
    errorMsg.style.display = 'none';
    emailError.style.display = 'none';
    customerNameError.style.display = 'none';
    companyNameError.style.display = 'none';
    companyAddressError.style.display = 'none';
  }

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideMessages();

    // Validate required fields
    var customerName = customerNameInput.value.trim();
    var email = emailInput.value.trim();
    var companyName = companyNameInput.value.trim();
    var companyAddress = companyAddressInput.value.trim();

    var hasErrors = false;

    if (!customerName) {
      customerNameError.style.display = 'block';
      if (!hasErrors) customerNameInput.focus();
      hasErrors = true;
    }

    if (!email || !validateEmail(email)) {
      emailError.style.display = 'block';
      if (!hasErrors) emailInput.focus();
      hasErrors = true;
    }

    if (!companyName) {
      companyNameError.style.display = 'block';
      if (!hasErrors) companyNameInput.focus();
      hasErrors = true;
    }

    if (!companyAddress) {
      companyAddressError.style.display = 'block';
      if (!hasErrors) companyAddressInput.focus();
      hasErrors = true;
    }

    if (hasErrors) {
      return;
    }

    setLoading(true);

    // Gather form data
    var data = {
      customer_name: customerName,
      email: email,
      company_name: companyName,
      company_address: companyAddress,
      company_phone: form.querySelector('[name="company_phone"]').value.trim(),
      company_ein: form.querySelector('[name="company_ein"]').value.trim(),
      customer_asi: form.querySelector('[name="customer_asi"]').value.trim(),
      customer_ppai: form.querySelector('[name="customer_ppai"]').value.trim(),
      email_opt_in: form.querySelector('[name="email_opt_in"]').checked
    };

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (result) {
        setLoading(false);
        if (result.success) {
          if (result.mode === 'upgraded') {
            showSuccess(
              "Thanks — we've added your wholesale application to your existing account. " +
              "You'll receive an email once it's approved."
            );
          } else {
            showSuccess();
          }
          return;
        }
        switch (result.mode) {
          case 'already_pending':
            showInfo(
              "Your wholesale application is already pending review. " +
              "We'll email you once it's approved."
            );
            break;
          case 'already_approved':
            showInfo(
              "An approved account already exists for this email. " +
              '<a href="/account/login" class="register-message-link">Log in here</a> to continue.'
            );
            break;
          default:
            showError(result.error || 'Registration failed. Please try again.');
        }
      })
      .catch(function (err) {
        setLoading(false);
        console.error('Registration error:', err);
        showError('Unable to connect. Please check your connection and try again.');
      });
  });
})();
