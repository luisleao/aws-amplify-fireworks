#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";

import { FireworksEventsStack } from "../lib/fireworks-events-stack";

const app = new cdk.App();

new FireworksEventsStack(app, "FireworksEvents", {
  // Sem env explícito a stack herda conta e região do perfil da AWS CLI em uso.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: "Canal em tempo real dos fogos de artifício (AppSync Events)",
});
