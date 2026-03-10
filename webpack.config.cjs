const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/index.ts',
  target: 'node',
  devtool: 'source-map',
  experiments: {outputModule: true},
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.mjs',
    library: {type: 'module'},
    chunkFormat: 'module',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [{
          loader: 'ts-loader',
          options: {
            // Declarations are generated separately via tsc
            compilerOptions: {declaration: false, declarationMap: false},
          },
        }],
        exclude: /node_modules/,
      },
    ],
  },
  externals: {
    // Keep fhirpath as external dependency (peer/dependency, not bundled)
    fhirpath: 'module fhirpath',
    'fhirpath/fhir-context/r4/index.js': 'module fhirpath/fhir-context/r4/index.js',
    // Node built-ins
    crypto: 'module node:crypto',
    'fs/promises': 'module node:fs/promises',
    fs: 'module node:fs',
    path: 'module node:path',
    events: 'module node:events',
  },
};
