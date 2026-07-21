fetch("http://localhost:54321/functions/v1/resolve-outcomes", {
  method: "POST",
  headers: { "Content-Type": "application/json" }
})
.then(res => res.text())
.then(console.log);
