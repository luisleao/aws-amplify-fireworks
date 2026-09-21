import * as cdk from "aws-cdk-lib";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

/**
 * Canal em tempo real dos fogos.
 *
 * A separação de autorização é o ponto central da stack:
 *
 *   conectar  → API_KEY   (o telão, num navegador)
 *   assinar   → API_KEY   (idem)
 *   publicar  → AWS_IAM   (só o backend Next.js, assinando com SigV4)
 *
 * Como publicar exige SigV4, a chave que vai no bundle do telão não consegue
 * injetar fogos — ela só escuta. Quem publica é a role de compute do Amplify.
 *
 * Usa construtos L1 (`Cfn*`) de propósito: a Event API não tem L2 estável em
 * todas as versões do aws-cdk-lib, e o L1 acompanha o CloudFormation direto.
 */

const NAMESPACE = "default";
const CHANNEL = `/${NAMESPACE}/show`;
const API_KEY_VALID_DAYS = 365;

export class FireworksEventsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const api = new appsync.CfnApi(this, "EventApi", {
      name: "fireworks-events",
      eventConfig: {
        authProviders: [{ authType: "API_KEY" }, { authType: "AWS_IAM" }],
        connectionAuthModes: [{ authType: "API_KEY" }],
        defaultPublishAuthModes: [{ authType: "AWS_IAM" }],
        defaultSubscribeAuthModes: [{ authType: "API_KEY" }],
      },
    });

    new appsync.CfnChannelNamespace(this, "ShowNamespace", {
      apiId: api.attrApiId,
      name: NAMESPACE,
      // Repetido no namespace para que o padrão da API não possa ser afrouxado
      // sem passar por aqui.
      publishAuthModes: [{ authType: "AWS_IAM" }],
      subscribeAuthModes: [{ authType: "API_KEY" }],
    });

    const apiKey = new appsync.CfnApiKey(this, "SubscriberKey", {
      apiId: api.attrApiId,
      description: "Chave pública de leitura usada pelo telão",
      // Calculada no synth: a validade conta a partir do último deploy.
      expires: Math.floor(Date.now() / 1000) + API_KEY_VALID_DAYS * 24 * 60 * 60,
    });

    const namespaceArn = cdk.Arn.format(
      {
        service: "appsync",
        resource: "apis",
        resourceName: `${api.attrApiId}/channelNamespace/${NAMESPACE}`,
      },
      this,
    );

    const publishPolicy = new iam.ManagedPolicy(this, "PublishPolicy", {
      description: "Permite publicar fogos no canal do telão",
      statements: [
        new iam.PolicyStatement({
          actions: ["appsync:EventPublish"],
          resources: [namespaceArn],
        }),
      ],
    });

    // Anexada ao app no console do Amplify (App settings → IAM roles). A
    // confiança em amplify.amazonaws.com é o que permite esse vínculo.
    const computeRole = new iam.Role(this, "AmplifyComputeRole", {
      assumedBy: new iam.ServicePrincipal("amplify.amazonaws.com"),
      description: "Role de compute SSR do Amplify para o app de fogos",
      managedPolicies: [publishPolicy],
    });

    const outputs: Record<string, { value: string; description: string }> = {
      EventsHttpDomain: {
        value: cdk.Fn.getAtt(api.logicalId, "Dns.Http").toString(),
        description: "EVENTS_HTTP_DOMAIN / NEXT_PUBLIC_EVENTS_HTTP_DOMAIN",
      },
      EventsRealtimeDomain: {
        value: cdk.Fn.getAtt(api.logicalId, "Dns.Realtime").toString(),
        description: "NEXT_PUBLIC_EVENTS_REALTIME_DOMAIN",
      },
      EventsApiKey: {
        value: cdk.Fn.getAtt(apiKey.logicalId, "ApiKey").toString(),
        description: "NEXT_PUBLIC_EVENTS_API_KEY (pública: só conecta e assina)",
      },
      EventsChannel: {
        value: CHANNEL,
        description: "EVENTS_CHANNEL / NEXT_PUBLIC_EVENTS_CHANNEL",
      },
      AmplifyComputeRoleArn: {
        value: computeRole.roleArn,
        description: "Anexe como Compute role do app no console do Amplify",
      },
      PublishPolicyArn: {
        value: publishPolicy.managedPolicyArn,
        description: "Anexe ao seu usuário IAM para publicar em desenvolvimento",
      },
    };

    for (const [name, output] of Object.entries(outputs)) {
      new cdk.CfnOutput(this, name, output);
    }
  }
}
