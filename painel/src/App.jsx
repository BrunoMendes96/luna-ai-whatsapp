import { useEffect, useState } from "react";

const API_URL = "https://luna-ai-whatsapp-production.up.railway.app";

const STATUS_OPTIONS = [
  "Novo Lead",
  "Em Atendimento",
  "Aguardando Confirmação",
  "Fechado",
  "Perdido"
];

function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("luna_admin");
    return saved ? JSON.parse(saved) : null;
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [conversations, setConversations] = useState([]);

  function login(e) {
    e.preventDefault();

    if (
      email.trim().toLowerCase() === "bruno.coop32@icloud.com" &&
      password.trim() === "jaftYw-nirke9-dibsab"
    ) {
      const adminSession = { user: { email: "bruno.coop32@icloud.com" } };
      localStorage.setItem("luna_admin", JSON.stringify(adminSession));
      setSession(adminSession);
      return;
    }

    alert("Email ou senha incorretos");
  }

  function logout() {
    localStorage.removeItem("luna_admin");
    setSession(null);
  }

  async function loadConversations() {
    try {
      const response = await fetch(`${API_URL}/api/conversations`);
      const data = await response.json();
      setConversations(data);
    } catch (error) {
      console.error(error);
    }
  }

  async function updateStatus(phone, status) {
    await fetch(`${API_URL}/api/conversations/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, status })
    });

    loadConversations();
  }

  useEffect(() => {
    if (!session) return;

    loadConversations();

    const interval = setInterval(loadConversations, 3000);

    return () => clearInterval(interval);
  }, [session]);

  if (!session) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <form onSubmit={login} className="bg-zinc-900 p-8 rounded-2xl w-full max-w-md">
          <h1 className="text-3xl font-bold mb-6">Luna AI</h1>

          <input
            className="w-full bg-zinc-800 p-4 rounded-xl mb-4"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="w-full bg-zinc-800 p-4 rounded-xl mb-6"
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="w-full bg-white text-black p-4 rounded-xl font-bold">
            Entrar
          </button>
        </form>
      </div>
    );
  }

  const totalNovo = conversations.filter(
    (c) => (c.status || "Novo Lead") === "Novo Lead"
  ).length;

  const totalAtendimento = conversations.filter(
    (c) => c.status === "Em Atendimento"
  ).length;

  const totalConfirmacao = conversations.filter(
    (c) => c.status === "Aguardando Confirmação"
  ).length;

  const totalFechado = conversations.filter(
    (c) => c.status === "Fechado"
  ).length;

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-5xl font-bold">Luna AI CRM</h1>
            <p className="text-zinc-400 mt-3">Logado como {session.user.email}</p>
          </div>

          <button
            onClick={logout}
            className="bg-red-500/20 text-red-400 px-5 py-3 rounded-2xl"
          >
            Sair
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-5 mb-10">
          <Card title="Conversas" value={conversations.length} />
          <Card title="Novos" value={totalNovo} />
          <Card title="Atendimento" value={totalAtendimento} />
          <Card title="Confirmação" value={totalConfirmacao} />
          <Card title="Fechados" value={totalFechado} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {STATUS_OPTIONS.map((status) => (
            <div
              key={status}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5"
            >
              <h2 className="text-xl font-bold mb-5">{status}</h2>

              {[...conversations]
                .reverse()
                .filter(
                  (conversation) =>
                    (conversation.status || "Novo Lead") === status
                )
                .map((conversation, index) => (
                  <div
                    key={index}
                    className="bg-zinc-800 rounded-2xl p-5 mb-5"
                  >
                    <p className="font-bold text-lg mb-4">
                      {conversation.phone}
                    </p>

                    <select
                      className="w-full bg-zinc-900 rounded-xl p-3 mb-4"
                      value={conversation.status || "Novo Lead"}
                      onChange={(e) =>
                        updateStatus(conversation.phone, e.target.value)
                      }
                    >
                      {STATUS_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>

                    <div className="space-y-3 max-h-96 overflow-auto">
                      {[...conversation.history]
                        .reverse()
                        .map((msg, idx) => (
                          <div
                            key={idx}
                            className={`p-3 rounded-xl ${
                              msg.role === "user"
                                ? "bg-zinc-700"
                                : "bg-green-500/20"
                            }`}
                          >
                            <p className="text-xs text-zinc-400 mb-1">
                              {msg.role === "user" ? "Cliente" : "IA"}
                            </p>

                            <p className="text-sm">{msg.content}</p>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
      <p className="text-zinc-400 text-sm">{title}</p>
      <p className="text-4xl font-bold mt-4">{value}</p>
    </div>
  );
}

export default App;