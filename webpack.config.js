const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/index.ts',
  target: 'node',
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    library: {type: 'commonjs2'},
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
    fhirpath: 'commonjs fhirpath',
    'fhirpath/fhir-context/r4': 'commonjs fhirpath/fhir-context/r4',
  },
};
