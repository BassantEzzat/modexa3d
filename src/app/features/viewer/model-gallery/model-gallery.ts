import { Component, inject, input, output } from '@angular/core';
import { I18n } from '../../../core/i18n/i18n';
import { SampleModel } from '../../../core/models/sample-models';

@Component({
  selector: 'app-model-gallery',
  templateUrl: './model-gallery.html',
  styleUrl: './model-gallery.scss',
})
export class ModelGallery {
  protected readonly i18n = inject(I18n);

  readonly models = input.required<readonly SampleModel[]>();
  readonly activeId = input<string | null>(null);
  readonly selected = output<SampleModel>();
}