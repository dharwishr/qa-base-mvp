import { useState } from 'react'
import './App.css'

function App() {
  // Check for broken mode via URL params or environment variable
  const urlParams = new URLSearchParams(window.location.search);
  const isBrokenMode = urlParams.get('mode') === 'broken' ||
    import.meta.env.VITE_BROKEN_MODE === 'true';

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: ''
  });
  const [submitted, setSubmitted] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const handleReset = () => {
    setFormData({ username: '', email: '', password: '' });
    setSubmitted(false);
  };

  // BROKEN MODE: Different DOM structure with extra wrapper divs
  // Changes XPath from: html/body/div/div/main/form/div[1]/input
  // To: html/body/div/div/section/div/form/div/div[1]/div/input
  if (isBrokenMode) {
    return (
      <div className="container-alt">
        <div className="inner-wrapper">
          <header className="header-alt">
            <h1 id="page-heading" data-testid="heading-element">
              Auto Heal Test Page
            </h1>
            <p className="mode-badge-alt">
              Mode: BROKEN (Changed Locators & DOM Structure)
            </p>
          </header>

          <section className="main-section">
            <div className="section-inner">
              {!submitted ? (
                <form
                  onSubmit={handleSubmit}
                  id="registration-form"
                  className="form-wrapper"
                  data-testid="reg-form"
                >
                  <div className="fields-container">
                    <div className="input-group">
                      <div className="field-wrapper">
                        <label
                          htmlFor="user-name-input"
                          className="input-label"
                        >
                          Username
                        </label>
                        <input
                          type="text"
                          id="user-name-input"
                          name="username"
                          className="text-input"
                          data-testid="username-field"
                          value={formData.username}
                          onChange={handleInputChange}
                          placeholder="Enter your username"
                        />
                      </div>
                    </div>

                    <div className="input-group">
                      <div className="field-wrapper">
                        <label
                          htmlFor="email-address-input"
                          className="input-label"
                        >
                          Email Address
                        </label>
                        <input
                          type="email"
                          id="email-address-input"
                          name="email"
                          className="text-input email-field"
                          data-testid="email-field"
                          value={formData.email}
                          onChange={handleInputChange}
                          placeholder="Enter your email"
                        />
                      </div>
                    </div>

                    <div className="input-group">
                      <div className="field-wrapper">
                        <label
                          htmlFor="pwd-input"
                          className="input-label"
                        >
                          Password
                        </label>
                        <input
                          type="password"
                          id="pwd-input"
                          name="password"
                          className="text-input password-field"
                          data-testid="password-field"
                          value={formData.password}
                          onChange={handleInputChange}
                          placeholder="Enter your password"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="action-buttons">
                    <div className="button-wrapper">
                      <button
                        type="submit"
                        id="register-btn"
                        className="primary-btn"
                        data-testid="register-button"
                      >
                        Sign Up
                      </button>
                    </div>
                    <div className="button-wrapper">
                      <button
                        type="button"
                        id="clear-btn"
                        className="secondary-btn"
                        data-testid="clear-button"
                        onClick={handleReset}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div
                  className="result-panel"
                  id="submission-result"
                  data-testid="result-display"
                >
                  <h2 className="result-heading" id="result-title">
                    Registration Successful!
                  </h2>
                  <div className="user-details">
                    <div className="detail-row">
                      <span className="detail-label">Username:</span>
                      <span
                        id="display-username"
                        className="detail-value"
                        data-testid="shown-username"
                      >
                        {formData.username}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Email:</span>
                      <span
                        id="display-email"
                        className="detail-value"
                        data-testid="shown-email"
                      >
                        {formData.email}
                      </span>
                    </div>
                  </div>
                  <div className="button-wrapper">
                    <button
                      id="go-back-btn"
                      className="secondary-btn"
                      data-testid="back-link"
                      onClick={handleReset}
                    >
                      Go Back
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <footer className="footer-section">
            <p id="copyright-notice" className="copyright-text">
              © 2024 Auto Heal Test App
            </p>
          </footer>
        </div>
      </div>
    );
  }

  // CORRECT MODE: Standard DOM structure
  // XPath: html/body/div/div/main/form/div[1]/input
  return (
    <div className="container">
      <header className="header">
        <h1
          id="main-title"
          data-testid="title-element"
        >
          Auto Heal Test Page
        </h1>
        <p className="mode-badge">
          Mode: CORRECT (Original Locators)
        </p>
      </header>

      <main className="content">
        {!submitted ? (
          <form
            onSubmit={handleSubmit}
            id="signup-form"
            className="form-container"
            data-testid="signup-form"
          >
            <div className="form-group">
              <label
                htmlFor="username"
                className="form-label"
              >
                Username
              </label>
              <input
                type="text"
                id="username"
                name="username"
                className="form-input"
                data-testid="username-input"
                value={formData.username}
                onChange={handleInputChange}
                placeholder="Enter your username"
              />
            </div>

            <div className="form-group">
              <label
                htmlFor="email"
                className="form-label"
              >
                Email Address
              </label>
              <input
                type="email"
                id="email"
                name="email"
                className="form-input email-input"
                data-testid="email-input"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="Enter your email"
              />
            </div>

            <div className="form-group">
              <label
                htmlFor="password"
                className="form-label"
              >
                Password
              </label>
              <input
                type="password"
                id="password"
                name="password"
                className="form-input password-input"
                data-testid="password-input"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Enter your password"
              />
            </div>

            <div className="button-group">
              <button
                type="submit"
                id="submit-button"
                className="btn-submit"
                data-testid="submit-btn"
              >
                Sign Up
              </button>
              <button
                type="button"
                id="reset-button"
                className="btn-reset"
                data-testid="reset-btn"
                onClick={handleReset}
              >
                Clear
              </button>
            </div>
          </form>
        ) : (
          <div
            className="success-message"
            id="success-container"
            data-testid="success-display"
          >
            <h2
              className="success-title"
              id="success-heading"
            >
              Registration Successful!
            </h2>
            <div className="submitted-data">
              <p>
                <span className="data-label">Username:</span>
                <span
                  id="username-value"
                  className="data-value"
                  data-testid="username-display"
                >
                  {formData.username}
                </span>
              </p>
              <p>
                <span className="data-label">Email:</span>
                <span
                  id="email-value"
                  className="data-value"
                  data-testid="email-display"
                >
                  {formData.email}
                </span>
              </p>
            </div>
            <button
              id="back-button"
              className="btn-back"
              data-testid="back-btn"
              onClick={handleReset}
            >
              Go Back
            </button>
          </div>
        )}
      </main>

      <footer className="footer">
        <p
          id="footer-text"
          className="footer-content"
        >
          © 2024 Auto Heal Test App
        </p>
      </footer>
    </div>
  )
}

export default App
