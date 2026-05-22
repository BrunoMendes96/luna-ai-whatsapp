import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function login(e) {
  e.preventDefault();

  if (email === "bruno.coop32@icloud.com" && password === "jaftYw-nirke9-dibsak") {
    setSession({
      user: {
        email: "bruno.coop32@icloud.com"
      }
    });
    return;
  }

  alert("Email ou senha incorretos");
}

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      alert("Erro no login: " + error.message);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, sessionData) => {
        setSession(sessionData);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  if (!session) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <form
          onSubmit={login}
          className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 w-full max-w-md"
        >
          <h1 className="text-3xl font-bold">Luna AI</h1>
          <p className="text-zinc-400 mt-2 mb-8">Login do painel admin</p>

          <input
            className="w-full bg-zinc-800 rounded-xl p-4 mb-4 outline-none"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="w-full bg-zinc-800 rounded-xl p-4 mb-6 outline-none"
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="w-full bg-white text-black rounded-xl p-4 font-bold">
            Entrar
          </button>
        </form>
      </div>
    );
  }

  return <Dashboard logout={logout} user={session.user} />;
}

function Dashboard({ logout, user }) {
  const [conversations, setConversations] = useState([]);

  async function loadConversations() {
    const response = await fetch("https://luna-ai-whatsapp-production.up.railway.app/api/conversations");
    const data = await response.json();
    setConversations(data);
  }

  useEffect(() => {
    loadConversations();

    const channel = supabase
      .channel("realtime-conversations")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations"
        },
        () => {
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-5xl font-bold">Luna AI Dashboard</h1>
            <p className="text-zinc-400 mt-3">Logado como {user.email}</p>
          </div>

          <button
            onClick={logout}
            className="bg-red-500/20 text-red-400 px-5 py-3 rounded-2xl"
          >
            Sair
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          <Card title="Conversas" value={conversations.length} />
          <Card title="IA" value="Online" />
          <Card title="Tempo real" value="Ativo" />
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
          <h2 className="text-3xl font-bold mb-8">Conversas Reais</h2>

          {conversations.map((conversation, index) => (
            <div key={index} className="bg-zinc-800 rounded-2xl p-6 mb-6">
              <p className="text-sm text-zinc-400 mb-4">
                Cliente: {conversation.phone}
              </p>

              {conversation.history.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-xl mb-3 ${
                    msg.role === "user" ? "bg-zinc-700" : "bg-green-500/20"
                  }`}
                >
                  <p className="text-xs text-zinc-400 mb-1">
                    {msg.role === "user" ? "Cliente" : "IA"}
                  </p>
                  <p>{msg.content}</p>
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
