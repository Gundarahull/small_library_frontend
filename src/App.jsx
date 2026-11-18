import { useCallback, useEffect, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(
  /\/$/,
  "",
);
const PAGE_SIZE = 8;

function readSession() {
  try {
    return JSON.parse(localStorage.getItem("library-session") || "null");
  } catch {
    return null;
  }
}

function getErrorMessage(body, status) {
  if (body?.message) return body.message;
  if (typeof body?.errors === "string") return body.errors;
  if (Array.isArray(body?.errors) && body.errors.length) {
    return body.errors.map((error) => error.msg).filter(Boolean).join(" ");
  }
  return `Request failed (${status}). Please try again.`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

function isOverdue(loan) {
  return !loan.returnedAt && new Date(loan.dueAt) < new Date();
}

async function apiRequest(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(getErrorMessage(body, response.status));
  }
  return body;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!result.token) throw new Error("Sign in succeeded but no token was returned.");
      onLogin({
        token: result.token,
        member: result.data,
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark" aria-hidden="true">S</div>
        <p className="eyebrow">YOUR NEIGHBORHOOD LIBRARY</p>
        <h1>Welcome back.</h1>
        <p className="muted">Sign in to find your next good read.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="notice error" role="alert">{error}</p>}
          <button className="primary-button full-width" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

function App() {
  const [session, setSession] = useState(readSession);
  const [books, setBooks] = useState([]);
  const [loans, setLoans] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [loadingLoans, setLoadingLoans] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyBookId, setBusyBookId] = useState(null);
  const [busyLoanId, setBusyLoanId] = useState(null);

  const signOut = useCallback(() => {
    localStorage.removeItem("library-session");
    setSession(null);
    setBooks([]);
    setLoans([]);
    setError("");
    setNotice("");
  }, []);

  const loadBooks = useCallback(async () => {
    if (!session) return;
    setLoadingBooks(true);
    setError("");
    try {
      const query = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (search) query.set("search", search);
      const result = await apiRequest(`/books?${query}`, {
        token: session.token,
      });
      setBooks(result.data || []);
      setTotalPages(Math.max(1, result.totalPages || 1));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingBooks(false);
    }
  }, [page, search, session]);

  const loadLoans = useCallback(async () => {
    if (!session) return;
    setLoadingLoans(true);
    try {
      const result = await apiRequest("/loans/me/loans", {
        token: session.token,
      });
      setLoans(result.data || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingLoans(false);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    loadBooks();
    loadLoans();
  }, [session, loadBooks, loadLoans]);

  function handleLogin(newSession) {
    localStorage.setItem("library-session", JSON.stringify(newSession));
    setSession(newSession);
    setNotice("You’re signed in. Welcome to the library!");
  }

  async function refreshMemberData() {
    await Promise.all([loadBooks(), loadLoans()]);
  }

  async function handleBookAction(book) {
    setBusyBookId(book.id);
    setError("");
    setNotice("");
    try {
      if (book.availableCopies > 0) {
        const result = await apiRequest("/loans", {
          method: "POST",
          token: session.token,
          body: JSON.stringify({ bookId: book.id }),
        });
        setNotice(result.message || `“${book.title}” borrowed successfully.`);
      } else {
        const result = await apiRequest(`/books/${book.id}/reservations`, {
          method: "POST",
          token: session.token,
        });
        setNotice(result.message || `You joined the waiting list for “${book.title}”.`);
      }
      await refreshMemberData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyBookId(null);
    }
  }

  async function handleReturn(loan) {
    setBusyLoanId(loan.id);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest(`/loans/${loan.bookId}/return`, {
        method: "POST",
        token: session.token,
      });
      const fee = Number(result.data?.lateFee || 0);
      setNotice(
        fee > 0
          ? `“${loan.title}” returned. Late fee: ${fee}.`
          : `“${loan.title}” returned successfully. No late fee.`,
      );
      await refreshMemberData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyLoanId(null);
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  if (!session) return <Login onLogin={handleLogin} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Small Library home">
          <span className="wordmark-icon" aria-hidden="true">S</span>
          <span>small library</span>
        </a>
        <div className="account">
          <span className="account-label">
            {session.member?.name || `Member #${session.member?.id}`}
          </span>
          <button className="text-button" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main id="top" className="content">
        <section className="welcome">
          <div>
            <p className="eyebrow">A LITTLE TIME, A LOT OF STORIES</p>
            <h1>Find your next read.</h1>
            <p className="muted">Browse the shelves or pick up where you left off.</p>
          </div>
          <div className="welcome-stats">
            <span className="stat-number">{loans.filter((loan) => !loan.returnedAt).length}</span>
            <span className="stat-label">active loans</span>
          </div>
        </section>

        {(error || notice) && (
          <div
            className={`notice ${error ? "error" : "success"}`}
            role={error ? "alert" : "status"}
          >
            <span>{error || notice}</span>
            <button
              className="notice-dismiss"
              onClick={() => {
                setError("");
                setNotice("");
              }}
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        )}

        <section className="section books-section" aria-labelledby="books-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE COLLECTION</p>
              <h2 id="books-heading">Browse books</h2>
            </div>
            <form className="search-form" onSubmit={submitSearch}>
              <label className="sr-only" htmlFor="book-search">Search by title or author</label>
              <input
                id="book-search"
                type="search"
                placeholder="Title or author"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              <button className="secondary-button">Search</button>
            </form>
          </div>

          {loadingBooks ? (
            <p className="empty-state">Loading books…</p>
          ) : books.length === 0 ? (
            <p className="empty-state">
              {search ? "No books match your search." : "There are no books to show yet."}
            </p>
          ) : (
            <div className="book-grid">
              {books.map((book) => (
                <article className="book-card" key={book.id}>
                  <div className="book-cover" aria-hidden="true">
                    <span>{book.title.slice(0, 1).toUpperCase()}</span>
                  </div>
                  <div className="book-info">
                    <p className="book-language">{book.language || "Book"}</p>
                    <h3>{book.title}</h3>
                    <p className="book-author">by {book.author}</p>
                    <p className={`availability ${book.availableCopies > 0 ? "in-stock" : "waitlist"}`}>
                      {book.availableCopies > 0
                        ? `${book.availableCopies} ${book.availableCopies === 1 ? "copy" : "copies"} available`
                        : "Currently checked out"}
                    </p>
                    <button
                      className={book.availableCopies > 0 ? "primary-button" : "secondary-button"}
                      onClick={() => handleBookAction(book)}
                      disabled={busyBookId === book.id}
                    >
                      {busyBookId === book.id
                        ? "Please wait…"
                        : book.availableCopies > 0
                          ? "Borrow book"
                          : "Join waiting list"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <nav className="pagination" aria-label="Book pages">
            <button
              className="secondary-button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loadingBooks}
            >
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              className="secondary-button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages || loadingBooks}
            >
              Next
            </button>
          </nav>
        </section>

        <section className="section loans-section" aria-labelledby="loans-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR READING LIST</p>
              <h2 id="loans-heading">My loans</h2>
            </div>
            {loadingLoans && <span className="muted">Updating…</span>}
          </div>

          {loans.length === 0 ? (
            <p className="empty-state">
              {loadingLoans ? "Loading your loans…" : "No loans yet. Borrow a book to get started."}
            </p>
          ) : (
            <div className="loan-list">
              {loans.map((loan) => {
                const overdue = isOverdue(loan);
                return (
                  <article className="loan-row" key={loan.id}>
                    <div className="loan-title">
                      <h3>{loan.title}</h3>
                      <p className="book-author">by {loan.author}</p>
                    </div>
                    <div className="loan-due">
                      <span className="detail-label">
                        {loan.returnedAt ? "Returned" : "Due date"}
                      </span>
                      <span>{formatDate(loan.returnedAt || loan.dueAt)}</span>
                    </div>
                    <div className="loan-status">
                      {loan.returnedAt ? (
                        <span className="status-pill returned">Returned</span>
                      ) : overdue ? (
                        <span className="status-pill overdue">Overdue</span>
                      ) : (
                        <span className="status-pill active">On loan</span>
                      )}
                    </div>
                    {loan.returnedAt ? (
                      <span className="returned-label">Complete</span>
                    ) : (
                      <button
                        className="secondary-button return-button"
                        onClick={() => handleReturn(loan)}
                        disabled={busyLoanId === loan.id}
                      >
                        {busyLoanId === loan.id ? "Returning…" : "Return"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
      <footer className="footer">Good stories are better shared.</footer>
    </div>
  );
}

export default App;
