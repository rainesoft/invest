fetch("http://localhost:54321/functions/v1/kill-switch", {
  method: "POST",
  headers: { "Content-Type": "application/json" }
})
.then(res => res.text())
.then(console.log);
