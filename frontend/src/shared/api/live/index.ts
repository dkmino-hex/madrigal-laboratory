import type { Operation } from '../registry';
import { page, readJob, record, type Context, type Params } from './common';
import * as capture from './capture';
import * as workspace from './workspace';
import * as analysis from './analysis';
import type { Location } from '../contracts/models';

export async function liveRequest(operation: Operation, p: Params, ctx: Context): Promise<unknown> {
  switch (operation) {
    case 'discover':
      return ctx.wire(operation, p, ctx.options);
    case 'saveAutomaticObservation':
      return workspace.saveAutomaticObservation(ctx, p);
    case 'projects':
      return workspace.projects(ctx, p);
    case 'project':
      return workspace.project(ctx, await ctx.wire(operation, p, ctx.options));
    case 'createProject':
      return workspace.project(ctx, await ctx.wire(operation, p, ctx.options));
    case 'captures':
      return capture.captures(ctx, p);
    case 'uploadCapture':
    case 'createAssembly':
      return capture.captureJob(ctx, operation, p);
    case 'sessions':
      return capture.sessionPage(ctx, p);
    case 'assemblies':
      return capture.assemblies(ctx, p);
    case 'bytes':
      return capture.window(ctx, p as Location);
    case 'sources':
      return capture.sources(ctx, p as Location);
    case 'packet':
      return capture.packet(ctx, p);
    case 'search':
      return capture.search(ctx, p);
    case 'settings':
      return workspace.settingList(ctx, p);
    case 'saveSettings':
      return workspace.saveSettings(ctx, p);
    case 'actions':
      return workspace.actions(ctx, p);
    case 'importActions':
      return workspace.importActions(ctx, p);
    case 'evidence':
      return page(await ctx.wire(operation, p, ctx.options));
    case 'saveEvidence':
      return workspace.saveEvidence(ctx, p);
    case 'hypotheses':
      return workspace.hypotheses(ctx, p);
    case 'saveHypothesis':
      return workspace.saveHypothesis(ctx, p);
    case 'deleteHypothesis':
      return ctx.wire(operation, p, ctx.options);
    case 'artifacts':
      return workspace.artifacts(ctx, p);
    case 'exportProject':
    case 'importProject':
    case 'createReport':
      return workspace.workspaceJob(ctx, operation, p);
    case 'interpretations':
      return analysis.interpretations(ctx, p);
    case 'interpretation':
      return analysis.interpretation(ctx, await ctx.wire(operation, p, ctx.options));
    case 'createInterpretation':
      return analysis.createInterpretation(ctx, p);
    case 'saveRevision':
      return analysis.saveRevision(ctx, p);
    case 'preview':
      return analysis.preview(ctx, p);
    case 'runs':
      return analysis.runs(ctx, p);
    case 'run':
      return analysis.run(ctx, await ctx.wire(operation, p, ctx.options));
    case 'createRun':
      return analysis.createRun(ctx, p);
    case 'results':
      return analysis.results(ctx, p);
    case 'job':
      return readJob(ctx, p.projectId, p.jobId);
    case 'cancelJob': {
      const value = record(await ctx.wire(operation, p, ctx.options));
      return readJob(ctx, p.projectId, value.jobId);
    }
  }
}
