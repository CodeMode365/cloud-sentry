import { App, Tags } from 'aws-cdk-lib';
import { buildCloudSentry } from '../app';

const app = new App();
const { config } = buildCloudSentry(app);
Tags.of(app).add('Project', 'CloudSentry');
Tags.of(app).add('Stage', config.stage);
app.synth();
