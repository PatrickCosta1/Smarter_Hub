import './LoadingScreen.css';

export default function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="loading-container">
        <div className="loading-logo-wrapper">
          <img src="/logo.png" alt="Smarter Hub" className="loading-logo" />
        </div>

        <p className="loading-title">Smarter Hub</p>
        <p className="loading-subtitle">A carregar o teu espaço de trabalho...</p>

        <div className="loading-bars">
          <span className="bar bar-1"></span>
          <span className="bar bar-2"></span>
          <span className="bar bar-3"></span>
          <span className="bar bar-4"></span>
          <span className="bar bar-5"></span>
        </div>

        <p className="loading-status">Aguarde alguns instantes...</p>
      </div>
    </main>
  );
}
