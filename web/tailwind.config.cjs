/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brandStart: "#6a5af9",
        brandEnd: "#a66cff",
      },
      boxShadow: {
        soft: "0 4px 24px rgba(0,0,0,0.08)",
      },
      borderRadius: {
        xl: "12px",
      },
    },
  },
  plugins: [],
};

