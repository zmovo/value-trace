const state = document.getElementById("load-state");

function formatCount(value) {
  return Number(value).toLocaleString("en-US");
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status}`);
  }
  return response.json();
}

async function main() {
  try {
    await Promise.all([loadJson("/mock/report"), loadJson("/mock/cache")]);
    const dashboard = await loadJson("/mock/dashboard");
    document.getElementById("entry").textContent = formatCount(dashboard.data.entryCount);
    document.getElementById("exit").textContent = formatCount(dashboard.data.exitCount);
    document.getElementById("occupancy").textContent = `${(dashboard.data.occupancyRate * 100).toFixed(1)}%`;
    document.getElementById("revenue").textContent = `$${Number(dashboard.data.revenue).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    document.getElementById("compact").textContent = "1.2K";
    state.textContent = "Loaded /mock/dashboard, /mock/report, and /mock/cache.";
  } catch (error) {
    state.textContent = error instanceof Error ? error.message : "Failed to load mock APIs";
  }
}

document.getElementById("reload")?.addEventListener("click", () => {
  void main();
});

void main();
