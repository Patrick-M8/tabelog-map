<script lang="ts">
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';

  import '../app.css';

  import { setupI18n } from '$lib/i18n';

  setupI18n();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false
      }
    }
  });
</script>

<svelte:head>
  <title>TabeMap</title>
  <meta
    name="description"
    content="Fast, map-first discovery for top-rated restaurants near you, designed for one-hand decision making."
  />
</svelte:head>

<QueryClientProvider client={queryClient}>
  <slot />
</QueryClientProvider>
