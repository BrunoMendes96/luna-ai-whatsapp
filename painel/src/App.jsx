import { useEffect, useState } from "react";

const API_URL = "https://luna-ai-whatsapp-production.up.railway.app";

const STATUS_OPTIONS = ["Novo Lead", "Em Atendimento", "Fechado", "Perdido"];

function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("luna_admin");
    return saved ? JSON.parse(saved) : null;
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function login(e) {
    e.preventDefault();

    if (email === "admin@luna.com" && password === "123456") {
      const adminSession = { user: { email: "admin@luna.com" } };
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

  if (!session) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <form onSubmit={login} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 w-full max-w-md">
          <h1 className="text-3xl font-bold">Luna AI</h1>
          <p className="text-zinc-400 mt-2 mb-8">Login do painel admin</p>

          <input className="w-full bg-zinc-800 rounded-xl p-4 mb-4 outline-none" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />

          <input className="w-full bg-zinc-800 rounded-xl p-4 mb-6 outline-none" placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />

          <button className="w-full bg-white text-black rounded-xl p-4 font-bold">Entrar</button>
        </form>
      </div>
    );
  }

  return <Dashboard logout={logout} user={session.user} />;
}

function Dashboard({ logout, user }) {
  const [conversations, setConversations] = useState([]);
  const [debug, setDebug] = useState("Carregando...");

  async function loadConversations() {
    try {
      const response = await fetch(`${API_URL}/api/conversations`);
      const data = await response.json();

      setConversations(data);
      setDebug(`OK - ${data.length} conversa(s) carregada(s)`);
    } catch (error) {
      setDebug("ERRO: " + error.message);
    }
  }

  async function updateStatus(phone, status) {
    await fetch(`${API_URL}/api/conversations/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone, status })
    });

    loadConversations();
  }

async function createAppointment(conversation) {
  const customerName =
    conversation.customer_name ||
    prompt("Nome do cliente:", "") ||
    "Cliente";

  const service =
    prompt("Serviço:", "Piercing") ||
    "Serviço não informado";

  const appointmentDate =
    prompt("Data e hora do agendamento:", "2026-05-22 15:00") ||
    "";

  if (!appointmentDate) {
    alert("Agendamento cancelado.");
    return;
  }

  await fetch(`${API_URL}/api/appointments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      customer_name: customerName,
      phone: conversation.phone,
      service,
      appointment_date: appointmentDate
    })
  });

  await updateStatus(conversation.phone, "Fechado");

  alert("Agendamento criado e lead marcado como Fechado.");
}

async function updateDetails(phone, customer_name, notes) {
  await fetch(`${API_URL}/api/conversations/details`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      phone,
      customer_name,
      notes
    })
  });

  loadConversations();
}

async function sendFollowup(phone, customerName) {
  const message = `Oi ${customerName} 😊

Vi que você entrou em contato conosco e queria saber se ainda deseja agendar ou tirar dúvidas. Estou à disposição 💙`;

  await fetch(`${API_URL}/api/followup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      phone,
      message
    })
  });

  alert("Follow-up enviado.");
}

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 3000);
    return () => clearInterval(interval);
  }, []);

  const totalNovo = conversations.filter((c) => c.status === "Novo Lead").length;
  const totalAtendimento = conversations.filter((c) => c.status === "Em Atendimento").length;
  const totalFechado = conversations.filter((c) => c.status === "Fechado").length;

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-5xl font-bold">Luna AI CRM</h1>
            <p className="text-zinc-400 mt-3">Logado como {user.email}</p>
            <p className="text-green-400 mt-2">{debug}</p>
          </div>

          <button onClick={logout} className="bg-red-500/20 text-red-400 px-5 py-3 rounded-2xl">
            Sair
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-10">
          <Card title="Conversas" value={conversations.length} />
          <Card title="Novos Leads" value={totalNovo} />
          <Card title="Em Atendimento" value={totalAtendimento} />
          <Card title="Fechados" value={totalFechado} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {STATUS_OPTIONS.map((status) => (
            <div key={status} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
              <h2 className="text-xl font-bold mb-5">{status}</h2>

              {conversations
                .filter((conversation) => (conversation.status || "Novo Lead") === status)
                .map((conversation, index) => (
                  <div key={index} className="bg-zinc-800 rounded-2xl p-5 mb-5">
                    <p className="text-sm text-zinc-400 mb-2">Cliente</p>
                    <div className="mb-4">
  <input
    className="w-full bg-zinc-900 rounded-xl p-3 mb-3"
    placeholder="Nome do cliente"
    defaultValue={conversation.customer_name || ""}
    onBlur={(e) =>
      updateDetails(
        conversation.phone,
        e.target.value,
        conversation.notes || ""
      )
    }
  />

  <textarea
    className="w-full bg-zinc-900 rounded-xl p-3"
    placeholder="Observações internas"
    defaultValue={conversation.notes || ""}
    onBlur={(e) =>
      updateDetails(
        conversation.phone,
        conversation.customer_name || "",
        e.target.value
      )
    }
  />
</div>

                    <select
                      className="w-full bg-zinc-900 rounded-xl p-3 mb-4"
                      value={conversation.status || "Novo Lead"}
                      onChange={(e) => updateStatus(conversation.phone, e.target.value)}
                    >
                      {STATUS_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>

<button
  onClick={() =>
    sendFollowup(
      conversation.phone,
      conversation.customer_name || "cliente"
    )
  }
  className="w-full bg-blue-500/20 text-blue-400 rounded-xl p-3 mb-4"
>
  Enviar Follow-up IA

<button
  onClick={() => createAppointment(conversation)}
  className="w-full bg-purple-500/20 text-purple-400 rounded-xl p-3 mb-4"
>
  Agendar Cliente
</button>

                    <div className="space-y-3 max-h-80 overflow-auto">
                      {conversation.history.map((msg, idx) => (
                        <div key={idx} className={`p-3 rounded-xl ${msg.role === "user" ? "bg-zinc-700" : "bg-green-500/20"}`}>
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