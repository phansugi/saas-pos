/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1280px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        /*
          Warna “bahaya”: teks galat, batas peringatan keras, tombol hapus.
          Kelasnya (`text-destructive`, `bg-destructive/10`, `border-destructive/40`)
          dipakai di puluhan tempat, tetapi token ini **tidak ada** di palet —
          jadi Tailwind tidak pernah membuat kelasnya dan semua peringatan galat
          tampil sebagai teks biasa. Ditambahkan bersama `--destructive` di
          `src/index.css` (terang & gelap) supaya peringatan yang memang urgent
          benar-benar terlihat berbeda.
        */
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Permukaan sidebar backstage (`src/index.css`): gelap di kedua tema.
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          deep: "hsl(var(--sidebar-deep))",
          foreground: "hsl(var(--sidebar-foreground))",
          muted: "hsl(var(--sidebar-muted))",
          border: "hsl(var(--sidebar-border))",
          active: "hsl(var(--sidebar-active))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        /*
          Kilat kartu antrean dapur saat tagihan QR baru masuk. Warnanya aksen
          yang berdenyut (bukan berkedip penuh-terang) dan latarnya tetap bisa
          dibaca isinya, karena yang perlu terlihat justru angkanya. Lamanya
          dibuat sama dengan `KDS_ALERT_FLASH_MS` di `src/convex/lib/fnb.ts`
          (5 × 1,2 s = 6 s) supaya animasi dan keadaannya padam bersamaan.
        */
        kilat: {
          "0%": { backgroundColor: "hsl(var(--accent) / 0.35)" },
          "50%": { backgroundColor: "hsl(var(--accent) / 0.08)" },
          "100%": { backgroundColor: "hsl(var(--accent) / 0.35)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s ease-out both",
        marquee: "marquee 28s linear infinite",
        kilat: "kilat 1.2s ease-in-out 5",
      },
    },
  },
  plugins: [],
};
