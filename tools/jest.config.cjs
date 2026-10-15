module.exports = {
    collectCoverageFrom: [
        'src/**/*.js',
    ],
    coverageReporters: ['text', 'lcov'],
    coverageThreshold: {
        global: {
            branches: 100,
            functions: 100,
            lines: 100,
            statements: 100,
        },
    },
};
