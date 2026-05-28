(function () {
  const root = document.documentElement;
  const hero = document.getElementById("hero");
  const copyButton = document.getElementById("copyEmail");
  const email = "youmilens@gmail.com";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobileViewport = window.matchMedia("(max-width: 768px)");
  let ticking = false;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function updateHeroProgress() {
    ticking = false;
    if (!hero || reducedMotion.matches || mobileViewport.matches) {
      root.style.setProperty("--hero-progress", "1");
      return;
    }

    const rect = hero.getBoundingClientRect();
    const travel = Math.max(1, window.innerHeight * 0.72);
    const progress = clamp((0 - rect.top) / travel, 0, 1);
    root.style.setProperty("--hero-progress", progress.toFixed(3));
  }

  function requestUpdate() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(updateHeroProgress);
    }
  }

  async function copyEmailToClipboard() {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(email);
        return true;
      } catch (error) {
        // Continue to the textarea fallback for browsers that block async clipboard writes.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = email;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    document.execCommand("copy");
    textarea.remove();
    return true;
  }

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate);
  if (typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", requestUpdate);
  } else if (typeof reducedMotion.addListener === "function") {
    reducedMotion.addListener(requestUpdate);
  }
  if (typeof mobileViewport.addEventListener === "function") {
    mobileViewport.addEventListener("change", requestUpdate);
  } else if (typeof mobileViewport.addListener === "function") {
    mobileViewport.addListener(requestUpdate);
  }
  updateHeroProgress();

  const chapters = Array.from(document.querySelectorAll(".chapter"));
  if ("IntersectionObserver" in window) {
    const chapterObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
        }
      });
    }, {
      rootMargin: "-12% 0px -18% 0px",
      threshold: 0.16
    });

    chapters.forEach((chapter) => chapterObserver.observe(chapter));
  } else {
    chapters.forEach((chapter) => chapter.classList.add("is-visible"));
  }

  if (reducedMotion.matches) {
    chapters.forEach((chapter) => chapter.classList.add("is-visible"));
  }

  const stackStage = document.querySelector(".screen-stack-stage");
  if (stackStage) {
    const stackCards = Array.from(stackStage.querySelectorAll(".product-screen"));
    const order = ["record", "courses", "settings"];
    let activeScreen = "record";
    let switchTimer;

    function setActiveScreen(nextActiveScreen) {
      activeScreen = nextActiveScreen;
      const activeIndex = order.indexOf(activeScreen);
      const nextScreen = order[(activeIndex + 1) % order.length];
      const lastScreen = order[(activeIndex + 2) % order.length];

      stackStage.classList.add("is-switching");
      window.clearTimeout(switchTimer);

      stackCards.forEach((card) => {
        card.classList.remove("screen-front", "screen-mid", "screen-back");
        if (card.dataset.screen === activeScreen) {
          card.classList.add("screen-front");
          card.setAttribute("aria-pressed", "true");
        } else if (card.dataset.screen === nextScreen) {
          card.classList.add("screen-mid");
          card.setAttribute("aria-pressed", "false");
        } else if (card.dataset.screen === lastScreen) {
          card.classList.add("screen-back");
          card.setAttribute("aria-pressed", "false");
        }
      });

      switchTimer = window.setTimeout(() => {
        stackStage.classList.remove("is-switching");
      }, 680);
    }

    window.setActiveYoumiScreen = setActiveScreen;

    stackStage.addEventListener("click", (event) => {
      const target = event.target.closest("[data-screen]");
      if (!target) return;
      setActiveScreen(target.dataset.screen);
    });

    setActiveScreen("record");
  }

  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      const original = copyButton.textContent;
      try {
        const copied = await copyEmailToClipboard();
        copyButton.textContent = copied ? "Copied" : email;
      } catch (error) {
        copyButton.textContent = email;
      }

      window.setTimeout(() => {
        copyButton.textContent = original;
      }, 1800);
    });
  }
}());
