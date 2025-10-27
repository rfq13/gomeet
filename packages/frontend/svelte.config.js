import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://svelte.dev/docs/kit/integrations
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  kit: {
    // Use adapter-node for Node.js environments like Kubernetes
    adapter: adapter({
      // Precompress the static files
      precompress: false,
      // External environment variables
      env: {
        host: "HOST",
        port: "PORT",
      },
    }),
    alias: {
      $lib: "./src/lib",
      $components: "./src/components",
      $types: "./src/types",
    },
  },
};

export default config;
