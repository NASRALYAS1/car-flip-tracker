// Custom-styled confirm/alert dialogs, replacing the native browser
// confirm()/alert() — those show the raw domain name and can't be styled,
// which looks jarring and out of place in an installed app. Both return
// a Promise so call sites just do `if (!(await UI.confirm(...))) return;`.
const UI = {
  confirm(message, { okText = "تأكيد", cancelText = "إلغاء", danger = false } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "ui-modal-overlay";
      overlay.innerHTML = `
        <div class="ui-modal-card">
          <p class="ui-modal-msg">${message}</p>
          <div class="btn-row">
            <button type="button" class="btn secondary" id="ui-modal-cancel">${cancelText}</button>
            <button type="button" class="btn ${danger ? "danger" : ""}" id="ui-modal-ok">${okText}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };
      overlay.querySelector("#ui-modal-ok").addEventListener("click", () => cleanup(true));
      overlay.querySelector("#ui-modal-cancel").addEventListener("click", () => cleanup(false));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) cleanup(false);
      });
    });
  },

  alert(message, { okText = "حسناً" } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "ui-modal-overlay";
      overlay.innerHTML = `
        <div class="ui-modal-card">
          <p class="ui-modal-msg">${message}</p>
          <button type="button" class="btn" id="ui-modal-ok" style="margin-top:4px">${okText}</button>
        </div>`;
      document.body.appendChild(overlay);

      const cleanup = () => {
        overlay.remove();
        resolve();
      };
      overlay.querySelector("#ui-modal-ok").addEventListener("click", cleanup);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) cleanup();
      });
    });
  },
};
