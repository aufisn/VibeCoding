// FridgeChef page. Talks only to its own server (/api/...), never to OpenRouter
// directly, so it never needs the API key.

const status = document.getElementById("status");

try {
  const res = await fetch("/api/status");
  const data = await res.json();
  if (!res.ok || !data.ready) throw new Error(data.error || "not ready");
  status.textContent = "✔ Ready: the server has your OpenRouter key.";
  document.getElementById("vision-model").textContent = data.models.vision;
  document.getElementById("text-model").textContent = data.models.text;
  document.getElementById("models").hidden = false;
} catch {
  status.textContent = "✖ The server isn't running. Start it with: npm start";
}
