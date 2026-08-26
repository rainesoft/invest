export default {
  output: "standalone",
  experimental: { serverActions: { allowedOrigins: ['*'] } },
  async redirects() {
    return [
      {
        source: '/research',
        destination: '/admin/research',
        permanent: true,
      },
      {
        source: '/opportunities',
        destination: '/admin/signals',
        permanent: true,
      },
    ];
  },
};

