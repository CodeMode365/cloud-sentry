/**
 * CloudWatch Embedded Metric Format (EMF). Lambda writes the JSON line to stdout; CloudWatch Logs
 * extracts it as a custom metric in namespace "CloudSentry" with the Stage dimension.
 */
export type MetricUnit = 'Count' | 'Milliseconds' | 'None';

export function emitMetric(
  name: string,
  value: number,
  unit: MetricUnit = 'Count',
  dimensions: Record<string, string> = {},
  sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): void {
  const stage = process.env.STAGE ?? 'local';
  const dims = { Stage: stage, ...dimensions };
  sink(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'CloudSentry',
            Dimensions: [Object.keys(dims)],
            Metrics: [{ Name: name, Unit: unit }],
          },
        ],
      },
      ...dims,
      [name]: value,
    }),
  );
}
